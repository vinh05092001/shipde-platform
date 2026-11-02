'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { parseListQuery, USERS_LIST_POLICY, type ListPolicy } from '@/lib/list-contract';

export interface SavedView<TFilters extends Record<string, string>> {
  id: string;
  name: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  filters: TFilters;
  createdAt: string;
}

export interface ColumnSettings {
  visibleColumns: string[];
  columnOrder?: string[];
}

export interface SharedListStateOptions<TFilters extends Record<string, string>> {
  defaultPage?: number;
  defaultPageSize?: number;
  defaultSortBy?: string;
  defaultSortOrder?: 'asc' | 'desc';
  defaultSearch?: string;
  defaultFilters: TFilters;
  policy?: ListPolicy;
  syncUrl?: boolean;
  namespace?: string;
  listKey?: string;
  initialColumns?: string[];
  tenantId?: string;
  userId?: string;
}

interface QueryState<TFilters> {
  page: number;
  pageSize: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  search: string;
  filters: TFilters;
}

export interface SharedListState<
  TFilters extends Record<string, string>,
> extends QueryState<TFilters> {
  hasActiveFilters: boolean;
  savedViews: SavedView<TFilters>[];
  columnSettings: ColumnSettings;
  preferencesEnabled: boolean;
  preferenceError: string | null;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  setSort: (field: string, direction?: 'asc' | 'desc') => void;
  setSortBy: (field: string) => void;
  setSortOrder: (order: 'asc' | 'desc' | ((previous: 'asc' | 'desc') => 'asc' | 'desc')) => void;
  setSearch: (search: string) => void;
  setFilter: <K extends keyof TFilters>(key: K, value: TFilters[K]) => void;
  resetFilters: () => void;
  getUrlSearchParams: () => URLSearchParams;
  saveCurrentView: (name: string) => SavedView<TFilters> | null;
  applySavedView: (id: string) => boolean;
  deleteSavedView: (id: string) => boolean;
  updateColumnSettings: (settings: Partial<ColumnSettings>) => void;
}

/** Identity comes exclusively from the authenticated context. Tuple encoding prevents ambiguous keys. */
export function listPreferenceKey(
  tenantId: string | undefined,
  userId: string | undefined,
  listKey: string | undefined
): string | null {
  if (
    ![tenantId, userId, listKey].every(
      (id) => typeof id === 'string' && id.length > 0 && id === id.trim()
    )
  )
    return null;
  return `shipde_pref_${JSON.stringify([tenantId, userId, listKey])}`;
}

function getStorageItemSafe(key: string): unknown {
  try {
    return typeof window === 'undefined'
      ? null
      : JSON.parse(window.localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function setStorageItemSafe(key: string, value: unknown): boolean {
  try {
    if (typeof window === 'undefined') return false;
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function useSharedListState<TFilters extends Record<string, string>>(
  options: SharedListStateOptions<TFilters>
): SharedListState<TFilters> {
  const policy = options.policy ?? USERS_LIST_POLICY;
  const { namespace, listKey = namespace, syncUrl = true } = options;
  const filtersJson = JSON.stringify(options.defaultFilters);
  const columnsJson = JSON.stringify(options.initialColumns ?? []);
  const defaultFilters = useMemo(() => JSON.parse(filtersJson) as TFilters, [filtersJson]);
  const initialColumns = useMemo(() => JSON.parse(columnsJson) as string[], [columnsJson]);
  const defaults = useMemo<QueryState<TFilters>>(
    () => ({
      page: options.defaultPage ?? policy.defaultPage,
      pageSize: options.defaultPageSize ?? policy.defaultSize,
      sortBy: options.defaultSortBy ?? policy.defaultSort,
      sortOrder: options.defaultSortOrder ?? policy.defaultDirection,
      search: options.defaultSearch ?? '',
      filters: defaultFilters,
    }),
    [
      options.defaultPage,
      options.defaultPageSize,
      options.defaultSortBy,
      options.defaultSortOrder,
      options.defaultSearch,
      policy,
      defaultFilters,
    ]
  );
  const prefStorageKey = listPreferenceKey(options.tenantId, options.userId, listKey);

  const validateQuery = useCallback(
    (candidate: QueryState<TFilters>): QueryState<TFilters> => {
      const raw: Record<string, unknown> = {
        [policy.pageKey]: candidate.page,
        [policy.sizeKey]: candidate.pageSize,
        sort_by: candidate.sortBy,
        sort_order: candidate.sortOrder,
      };
      for (const [key, value] of Object.entries(candidate.filters))
        if (value && value !== 'ALL') raw[key] = value;
      if (candidate.search.trim()) raw.search = candidate.search.trim();
      const parsed = parseListQuery(raw, policy);
      return {
        ...candidate,
        page: parsed.page,
        pageSize: parsed.limit,
        search: candidate.search,
        filters: { ...defaultFilters, ...parsed.filters },
      };
    },
    [policy, defaultFilters]
  );

  const readUrlQuery = useCallback((): QueryState<TFilters> => {
    if (typeof window === 'undefined' || !syncUrl) return defaults;
    const params = new URLSearchParams(window.location.search);
    const read = (key: string) => {
      const values = params.getAll(namespace ? `${namespace}_${key}` : key);
      if (values.length > 1) throw new Error('Repeated list parameter');
      return values[0];
    };
    const integer = (value: string | undefined, fallback: number): number => {
      if (value === undefined) return fallback;
      if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1)
        throw new Error('Invalid page parameter');
      return Number(value);
    };
    try {
      const filters = { ...defaultFilters };
      for (const key of Object.keys(filters)) {
        const value = read(key);
        if (value !== undefined) filters[key as keyof TFilters] = value as TFilters[keyof TFilters];
      }
      return validateQuery({
        page: integer(read('page'), defaults.page),
        pageSize: integer(read('limit') ?? read('pageSize') ?? read('size'), defaults.pageSize),
        sortBy: read('sort_by') ?? read('sortBy') ?? defaults.sortBy,
        sortOrder: (read('sort_order') ?? read('sortOrder') ?? defaults.sortOrder) as
          'asc' | 'desc',
        search: read('search') ?? read('q') ?? defaults.search,
        filters,
      });
    } catch {
      return defaults;
    }
  }, [syncUrl, namespace, defaults, defaultFilters, validateQuery]);

  const [queryState, setQueryState] = useState(() => ({
    key: prefStorageKey,
    query: readUrlQuery(),
  }));
  const query =
    queryState.key === prefStorageKey || (queryState.key === null && prefStorageKey !== null)
      ? queryState.query
      : defaults;
  useEffect(() => {
    if (queryState.key === prefStorageKey) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Bind initial URL state to authenticated identity; reset on account switches.
    setQueryState((previous) => ({
      key: prefStorageKey,
      query: previous.key === null && prefStorageKey !== null ? previous.query : defaults,
    }));
  }, [prefStorageKey, defaults, queryState.key]);

  const loadPreferences = useCallback(() => {
    const rawViews = prefStorageKey ? getStorageItemSafe(`${prefStorageKey}_views`) : null;
    const rawColumns = prefStorageKey ? getStorageItemSafe(`${prefStorageKey}_columns`) : null;
    const savedViews: SavedView<TFilters>[] = [];
    if (Array.isArray(rawViews))
      for (const view of rawViews) {
        if (
          !view ||
          typeof view !== 'object' ||
          typeof view.id !== 'string' ||
          typeof view.name !== 'string' ||
          !view.name.trim() ||
          !view.filters ||
          typeof view.filters !== 'object' ||
          Array.isArray(view.filters)
        )
          continue;
        try {
          const normalized = validateQuery({
            ...defaults,
            page: view.page ?? defaults.page,
            pageSize: view.pageSize ?? defaults.pageSize,
            sortBy: view.sortBy ?? defaults.sortBy,
            sortOrder: view.sortOrder ?? defaults.sortOrder,
            search: view.search ?? '',
            filters: view.filters,
          });
          savedViews.push({
            id: view.id,
            name: view.name,
            ...normalized,
            createdAt: typeof view.createdAt === 'string' ? view.createdAt : '',
          });
        } catch {
          /* Ignore invalid preferences instead of injecting a query. */
        }
      }
    const columns =
      rawColumns && typeof rawColumns === 'object' && 'visibleColumns' in rawColumns
        ? rawColumns.visibleColumns
        : null;
    const visibleColumns = Array.isArray(columns)
      ? initialColumns.filter((column) => columns.includes(column))
      : initialColumns;
    return {
      key: prefStorageKey,
      savedViews,
      columnSettings: {
        visibleColumns: visibleColumns.length ? visibleColumns : initialColumns,
      } as ColumnSettings,
    };
  }, [prefStorageKey, validateQuery, defaults, initialColumns]);
  const initialPreferences = useMemo(() => loadPreferences(), [loadPreferences]);
  const [preferences, setPreferences] = useState(initialPreferences);
  const activePreferences = preferences.key === prefStorageKey ? preferences : initialPreferences;
  const [preferenceError, setPreferenceError] = useState<string | null>(null);

  const updateQuery = useCallback(
    (change: Partial<QueryState<TFilters>>) => {
      setQueryState((previous) => {
        const current = previous.key === prefStorageKey ? previous.query : defaults;
        try {
          return { key: prefStorageKey, query: validateQuery({ ...current, ...change }) };
        } catch {
          return previous;
        }
      });
    },
    [prefStorageKey, defaults, validateQuery]
  );

  const setPage = useCallback((page: number) => updateQuery({ page }), [updateQuery]);
  const setPageSize = useCallback(
    (pageSize: number) => updateQuery({ pageSize, page: defaults.page }),
    [updateQuery, defaults.page]
  );
  const setSortBy = useCallback(
    (sortBy: string) => updateQuery({ sortBy, page: defaults.page }),
    [updateQuery, defaults.page]
  );
  const setSortOrder = useCallback(
    (value: 'asc' | 'desc' | ((previous: 'asc' | 'desc') => 'asc' | 'desc')) =>
      updateQuery({
        sortOrder: typeof value === 'function' ? value(query.sortOrder) : value,
        page: defaults.page,
      }),
    [updateQuery, query.sortOrder, defaults.page]
  );
  const setSort = useCallback(
    (sortBy: string, direction?: 'asc' | 'desc') =>
      updateQuery({
        sortBy,
        sortOrder:
          direction ?? (sortBy === query.sortBy && query.sortOrder === 'asc' ? 'desc' : 'asc'),
        page: defaults.page,
      }),
    [updateQuery, query.sortBy, query.sortOrder, defaults.page]
  );
  const setSearch = useCallback(
    (search: string) => updateQuery({ search, page: defaults.page }),
    [updateQuery, defaults.page]
  );
  const setFilter = useCallback(
    <K extends keyof TFilters>(key: K, value: TFilters[K]) =>
      updateQuery({ filters: { ...query.filters, [key]: value }, page: defaults.page }),
    [updateQuery, query.filters, defaults.page]
  );
  const resetFilters = useCallback(
    () => updateQuery({ search: defaults.search, filters: defaultFilters, page: defaults.page }),
    [updateQuery, defaults, defaultFilters]
  );

  const getUrlSearchParams = useCallback(() => {
    const params = new URLSearchParams();
    const set = (key: string, value: string | number) =>
      params.set(namespace ? `${namespace}_${key}` : key, String(value));
    set('page', query.page);
    set('limit', query.pageSize);
    set('sort_by', query.sortBy);
    set('sort_order', query.sortOrder);
    if (query.search.trim()) set('search', query.search.trim());
    for (const [key, value] of Object.entries(query.filters))
      if (value && value !== 'ALL') set(key, value);
    return params;
  }, [namespace, query]);
  useEffect(() => {
    if (!syncUrl || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const keys = [
      'page',
      'limit',
      'pageSize',
      'size',
      'sort_by',
      'sortBy',
      'sort_order',
      'sortOrder',
      'search',
      'q',
      ...Object.keys(defaultFilters),
    ];
    for (const key of keys) params.delete(namespace ? `${namespace}_${key}` : key);
    for (const key of Array.from(params.keys()))
      if (/^(tenant_id|merchant_id|user_id|token|secret|password|authorization)$/i.test(key))
        params.delete(key);
    for (const [key, value] of getUrlSearchParams()) params.set(key, value);
    const search = params.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`
    );
  }, [syncUrl, namespace, defaultFilters, getUrlSearchParams]);
  useEffect(() => {
    if (!syncUrl || typeof window === 'undefined') return;
    const restore = () => setQueryState({ key: prefStorageKey, query: readUrlQuery() });
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [syncUrl, prefStorageKey, readUrlQuery]);

  const persist = useCallback(
    (suffix: string, value: unknown) => {
      if (!prefStorageKey) return false;
      if (!setStorageItemSafe(`${prefStorageKey}_${suffix}`, value)) {
        setPreferenceError('Không thể lưu tùy chọn trong trình duyệt. Vui lòng thử lại.');
        return false;
      }
      setPreferenceError(null);
      return true;
    },
    [prefStorageKey]
  );
  const saveCurrentView = useCallback(
    (name: string): SavedView<TFilters> | null => {
      if (!prefStorageKey || !name.trim()) return null;
      const view: SavedView<TFilters> = {
        id: crypto.randomUUID(),
        name: name.trim(),
        ...query,
        filters: { ...query.filters },
        createdAt: new Date().toISOString(),
      };
      const next = [
        view,
        ...activePreferences.savedViews.filter((saved) => saved.name !== view.name),
      ];
      if (!persist('views', next)) return null;
      setPreferences({ ...activePreferences, key: prefStorageKey, savedViews: next });
      return view;
    },
    [prefStorageKey, query, activePreferences, persist]
  );
  const applySavedView = useCallback(
    (id: string) => {
      if (!prefStorageKey) return false;
      const view = activePreferences.savedViews.find((saved) => saved.id === id);
      if (!view) return false;
      updateQuery({ ...defaults, ...view });
      return true;
    },
    [prefStorageKey, activePreferences.savedViews, updateQuery, defaults]
  );
  const deleteSavedView = useCallback(
    (id: string) => {
      if (!prefStorageKey || !activePreferences.savedViews.some((view) => view.id === id))
        return false;
      const next = activePreferences.savedViews.filter((view) => view.id !== id);
      if (!persist('views', next)) return false;
      setPreferences({ ...activePreferences, key: prefStorageKey, savedViews: next });
      return true;
    },
    [prefStorageKey, activePreferences, persist]
  );
  const updateColumnSettings = useCallback(
    (settings: Partial<ColumnSettings>) => {
      if (!prefStorageKey) return;
      const selected = settings.visibleColumns ?? activePreferences.columnSettings.visibleColumns;
      const visibleColumns = initialColumns.filter((column) => selected.includes(column));
      if (!visibleColumns.length) return;
      const next = { ...activePreferences.columnSettings, visibleColumns };
      if (!persist('columns', next)) return;
      setPreferences({ ...activePreferences, key: prefStorageKey, columnSettings: next });
    },
    [prefStorageKey, activePreferences, initialColumns, persist]
  );

  return {
    ...query,
    savedViews: activePreferences.savedViews,
    columnSettings: activePreferences.columnSettings,
    preferencesEnabled: prefStorageKey !== null,
    preferenceError,
    hasActiveFilters:
      Boolean(query.search.trim()) ||
      Object.entries(query.filters).some(
        ([key, value]) => value && value !== 'ALL' && value !== defaultFilters[key]
      ),
    setPage,
    setPageSize,
    setSort,
    setSortBy,
    setSortOrder,
    setSearch,
    setFilter,
    resetFilters,
    getUrlSearchParams,
    saveCurrentView,
    applySavedView,
    deleteSavedView,
    updateColumnSettings,
  };
}

/**
 * In-memory client-side pagination, filter, and sort helper.
 */
export function paginateInMemory<T>(params: {
  items: readonly T[];
  page: number;
  pageSize: number;
  filterFn?: (item: T) => boolean;
  sortFn?: (a: T, b: T) => number;
}): {
  pagedItems: T[];
  total: number;
  totalPages: number;
  from: number;
  to: number;
} {
  const { items, page, pageSize, filterFn, sortFn } = params;
  let filtered = filterFn ? items.filter(filterFn) : [...items];
  if (sortFn) {
    filtered = filtered.sort(sortFn);
  }
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const skip = (safePage - 1) * pageSize;
  const pagedItems = filtered.slice(skip, skip + pageSize);
  const from = total === 0 ? 0 : skip + 1;
  const to = Math.min(skip + pageSize, total);

  return {
    pagedItems,
    total,
    totalPages,
    from,
    to,
  };
}
