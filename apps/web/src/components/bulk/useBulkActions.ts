'use client';

import { useState, useCallback } from 'react';
import {
  BulkActionType,
  BulkActionResponseData,
  BulkActionResponse,
  isDestructiveBulkAction,
} from './bulk-types';

export interface UseBulkActionsOptions {
  entityType: string;
  token?: string | null;
  initialSelectedIds?: string[];
  onSuccessMutation?: (action: string, succeededIds: string[], data?: any) => void;
}

export function useBulkActions({
  entityType,
  token,
  initialSelectedIds,
  onSuccessMutation,
}: UseBulkActionsOptions) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(initialSelectedIds || [])
  );
  const [inProgress, setInProgress] = useState<boolean>(false);
  const [progressText, setProgressText] = useState<string>('');
  const [actionError, setActionError] = useState<string | null>(null);

  // Modals state
  const [confirmModalOpen, setConfirmModalOpen] = useState<boolean>(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [assignScopesModalOpen, setAssignScopesModalOpen] = useState<boolean>(false);
  const [resultsModalOpen, setResultsModalOpen] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<BulkActionResponseData | null>(null);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback((allIds: string[]) => {
    setSelectedIds((prev) => {
      const allSelected = allIds.length > 0 && allIds.every((id) => prev.has(id));
      if (allSelected) {
        return new Set();
      }
      return new Set(allIds);
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const isAllSelected = useCallback(
    (allIds: string[]) => {
      return allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
    },
    [selectedIds]
  );

  const isPartiallySelected = useCallback(
    (allIds: string[]) => {
      if (allIds.length === 0 || selectedIds.size === 0) return false;
      const count = allIds.filter((id) => selectedIds.has(id)).length;
      return count > 0 && count < allIds.length;
    },
    [selectedIds]
  );

  const executeBulkAction = useCallback(
    async (
      action: string,
      confirm: boolean = false,
      params?: any,
      overrideIds?: string[]
    ): Promise<BulkActionResponseData | null> => {
      const targetIds = overrideIds || Array.from(selectedIds);
      if (targetIds.length === 0) return null;

      // Check destructive action confirmation requirement
      if (isDestructiveBulkAction(action) && !confirm) {
        setPendingAction(action);
        setConfirmModalOpen(true);
        return null;
      }

      setInProgress(true);
      setProgressText(`Đang xử lý ${targetIds.length} mục...`);
      setActionError(null);

      try {
        const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        const effectiveToken =
          token || (typeof window !== 'undefined' ? localStorage.getItem('shipde_token') : null);

        const idempotencyKey =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `idemp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'idempotency-key': idempotencyKey,
        };
        if (effectiveToken) {
          headers['Authorization'] = `Bearer ${effectiveToken}`;
        }

        const body = {
          entity_type: entityType,
          action,
          ids: targetIds,
          confirm: isDestructiveBulkAction(action) ? true : Boolean(confirm),
          params,
          idempotency_key: idempotencyKey,
        };

        const res = await fetch(`${API_BASE}/api/v1/bulk-actions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });

        const json = await res.json().catch(() => null);

        if (!res.ok) {
          const errMsg =
            json?.error?.message ||
            json?.message ||
            `Lỗi máy chủ (${res.status}): Không thể thực thi hàng loạt`;
          throw new Error(errMsg);
        }

        const responseData: BulkActionResponseData = json?.data || json;
        setLastResult(responseData);
        setResultsModalOpen(true);

        // Notify parent to mutate local state for succeeded items
        if (responseData.succeeded_ids?.length > 0 && onSuccessMutation) {
          onSuccessMutation(action, responseData.succeeded_ids, responseData);
        }

        // If all succeeded, clear selection; if partial, keep only failed items selected for retry
        if (responseData.failed_ids?.length > 0) {
          setSelectedIds(new Set(responseData.failed_ids));
        } else {
          clearSelection();
        }

        return responseData;
      } catch (err: any) {
        setActionError(err.message || 'Lỗi không xác định khi thực thi thao tác hàng loạt');
        return null;
      } finally {
        setInProgress(false);
        setProgressText('');
        setConfirmModalOpen(false);
        setPendingAction(null);
        setAssignScopesModalOpen(false);
      }
    },
    [entityType, selectedIds, token, clearSelection, onSuccessMutation]
  );

  const handleActionClick = useCallback(
    (action: string) => {
      if (action === BulkActionType.ASSIGN_SCOPES) {
        setAssignScopesModalOpen(true);
        return;
      }
      if (isDestructiveBulkAction(action)) {
        setPendingAction(action);
        setConfirmModalOpen(true);
        return;
      }
      void executeBulkAction(action, false);
    },
    [executeBulkAction]
  );

  const handleConfirmDestructive = useCallback(() => {
    if (pendingAction) {
      void executeBulkAction(pendingAction, true);
    }
  }, [pendingAction, executeBulkAction]);

  const handleConfirmAssignScopes = useCallback(
    (scopes: { store_scopes: string[]; warehouse_scopes: string[] }) => {
      void executeBulkAction(BulkActionType.ASSIGN_SCOPES, false, scopes);
    },
    [executeBulkAction]
  );

  const handleRetryFailed = useCallback(
    (failedIds: string[]) => {
      setResultsModalOpen(false);
      setSelectedIds(new Set(failedIds));
      if (lastResult?.action) {
        // If the action was destructive, confirm is still needed
        const wasDestructive = isDestructiveBulkAction(lastResult.action);
        void executeBulkAction(lastResult.action, wasDestructive, undefined, failedIds);
      }
    },
    [lastResult, executeBulkAction]
  );

  return {
    selectedIds,
    setSelectedIds,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
    isAllSelected,
    isPartiallySelected,
    inProgress,
    progressText,
    actionError,
    // Modals state & controls
    confirmModalOpen,
    setConfirmModalOpen,
    pendingAction,
    assignScopesModalOpen,
    setAssignScopesModalOpen,
    resultsModalOpen,
    setResultsModalOpen,
    lastResult,
    // Actions
    handleActionClick,
    handleConfirmDestructive,
    handleConfirmAssignScopes,
    handleRetryFailed,
    executeBulkAction,
  };
}
