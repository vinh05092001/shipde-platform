import React from 'react';

export interface CatalogRequestError {
  status?: number;
  correlationId?: string;
}
export function catalogRequestError(error: unknown): CatalogRequestError {
  if (!error || typeof error !== 'object') return {};
  return {
    status: 'status' in error && typeof error.status === 'number' ? error.status : undefined,
    correlationId:
      'correlationId' in error && typeof error.correlationId === 'string'
        ? error.correlationId
        : undefined,
  };
}
export function RequestFeedback({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: CatalogRequestError | null;
  onRetry: () => void;
}) {
  if (loading)
    return (
      <p role="status" aria-busy="true" className="p-5">
        Đang tải dữ liệu tham khảo…
      </p>
    );
  if (!error) return null;
  return (
    <div role="alert" className="p-5 space-y-3">
      <p>
        {error.status === 403
          ? '403 — Bạn cần quyền iam:carrier_catalog:read. Vui lòng liên hệ quản trị viên để được cấp quyền.'
          : error.status === 401
            ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
            : 'Không thể tải dữ liệu tham khảo. Vui lòng thử lại.'}
      </p>
      {error.correlationId && <p>Correlation ID: {error.correlationId}</p>}
      <button type="button" onClick={onRetry} className="px-3 py-2 border rounded-lg">
        Thử lại
      </button>
    </div>
  );
}
