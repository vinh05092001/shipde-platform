'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ListMetadata, ListPolicy } from '@shipde/contracts';
import {
  defaultResourceQuery,
  fetchListPage,
  ListReadError,
  type ListResource,
  type ResourceListQuery,
} from '@/lib/list-client';

interface ServerListOptions<T> {
  baseUrl: string;
  resource: ListResource;
  policy: ListPolicy;
  token: string | null;
  tenantId?: string;
  userId?: string;
  isHydrating: boolean;
  enabled?: boolean;
  initialRows?: T[];
  controlled?: boolean;
  initialLoading?: boolean;
  initialError?: string | null;
  initialForbidden?: boolean;
  initialTotal?: number;
  initialTotalPages?: number;
  initialCanEdit?: boolean;
}

export function useServerList<T>(options: ServerListOptions<T>) {
  const {
    baseUrl,
    resource,
    policy,
    token,
    tenantId,
    userId,
    isHydrating,
    enabled = true,
    initialRows,
    initialLoading,
    initialError,
    initialForbidden,
    initialTotal,
    initialTotalPages,
    initialCanEdit,
  } = options;
  const controlled = options.controlled ?? initialRows !== undefined;
  const contextKey = tenantId && userId && token ? JSON.stringify([tenantId, userId]) : null;
  const query = useRef(defaultResourceQuery(policy));
  const activeRequest = useRef<AbortController | null>(null);
  const [state, setState] = useState(() => ({
    rows: initialRows ?? [],
    meta: {
      correlation_id: '',
      page: policy.defaultPage,
      limit: policy.defaultSize,
      total: initialTotal ?? initialRows?.length ?? 0,
      total_pages:
        initialTotalPages ??
        Math.max(1, Math.ceil((initialTotal ?? initialRows?.length ?? 0) / policy.defaultSize)),
    } as ListMetadata,
    contextKey: controlled ? contextKey : null,
    loading: initialLoading ?? !controlled,
    error: initialError ?? null,
    forbidden: initialForbidden ?? false,
    canEdit: initialCanEdit ?? false,
  }));

  const refresh = useCallback(
    async (nextQuery?: ResourceListQuery) => {
      if (nextQuery) query.current = nextQuery;
      activeRequest.current?.abort();
      if (controlled) return;
      if (isHydrating || !contextKey || !token || !enabled) {
        setState((previous) => ({
          ...previous,
          rows: [],
          contextKey,
          loading: isHydrating,
          error: null,
          forbidden: !isHydrating,
          canEdit: false,
        }));
        return;
      }
      const controller = new AbortController();
      activeRequest.current = controller;
      setState((previous) => ({ ...previous, loading: true, error: null, forbidden: false }));
      try {
        const result = await fetchListPage<T>({
          baseUrl,
          resource,
          query: query.current,
          policy,
          token,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setState({
          rows: result.rows,
          meta: result.meta,
          contextKey,
          loading: false,
          error: null,
          forbidden: false,
          canEdit: initialCanEdit ?? result.canEdit ?? false,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        const denied =
          error instanceof ListReadError && (error.status === 401 || error.status === 403);
        setState((previous) => ({
          ...previous,
          rows: [],
          contextKey,
          loading: false,
          error:
            error instanceof ListReadError
              ? error.message
              : 'Không thể tải danh sách. Vui lòng thử lại.',
          forbidden: denied,
          canEdit: false,
        }));
      }
    },
    [baseUrl, resource, policy, token, contextKey, isHydrating, enabled, controlled, initialCanEdit]
  );

  const onQueryChange = useCallback(
    (next: ResourceListQuery) => {
      void refresh(next);
    },
    [refresh]
  );
  useEffect(() => () => activeRequest.current?.abort(), []);
  const sameContext = controlled || state.contextKey === contextKey;
  return {
    rows: sameContext ? state.rows : [],
    meta: sameContext ? state.meta : { ...state.meta, total: 0, total_pages: 1 },
    loading: controlled
      ? state.loading
      : isHydrating || (enabled && Boolean(contextKey) && !sameContext) || state.loading,
    error: sameContext ? state.error : null,
    forbidden: controlled
      ? state.forbidden
      : !isHydrating && (!contextKey || !enabled || (sameContext && state.forbidden)),
    canEdit: sameContext && state.canEdit,
    refresh,
    onQueryChange: controlled ? undefined : onQueryChange,
  };
}
