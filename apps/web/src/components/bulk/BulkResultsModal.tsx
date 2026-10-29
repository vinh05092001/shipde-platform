'use client';

import React from 'react';
import { CheckCircle2, AlertCircle, X, RotateCcw, Download, AlertTriangle } from 'lucide-react';
import { BulkActionResponseData, BulkItemStatus, formatBulkErrorMessage } from './bulk-types';

export interface BulkResultsModalProps {
  isOpen: boolean;
  result: BulkActionResponseData | null;
  itemLabels?: Record<string, string>; // Map item ID to friendly name or code
  onRetryFailed: (failedIds: string[]) => void;
  onClose: () => void;
}

export const BulkResultsModal: React.FC<BulkResultsModalProps> = ({
  isOpen,
  result,
  itemLabels = {},
  onRetryFailed,
  onClose,
}) => {
  if (!isOpen || !result) return null;

  const isPartial = result.is_partial_failure || result.failure_count > 0;
  const isAllSuccess = !isPartial && result.success_count > 0;
  const hasExport = Boolean(result.export_payload);

  const handleDownloadCsv = () => {
    if (!result.export_payload) return;
    try {
      const blob = new Blob([result.export_payload], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `bulk-export-${result.entity_type}-${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      // In non-browser / static markup test environment
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-results-title"
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
      data-testid="bulk-results-modal"
    >
      <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 flex items-start justify-between border-b border-slate-100">
          <div>
            <h3
              id="bulk-results-title"
              className="text-base font-bold text-slate-900"
              data-testid="bulk-results-title"
            >
              Báo cáo kết quả thực thi hàng loạt
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Mã đợt xử lý (Batch ID):{' '}
              <span className="font-mono text-slate-700 font-semibold" data-testid="bulk-batch-id">
                {result.batch_id}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng hộp thoại báo cáo"
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition cursor-pointer"
            data-testid="bulk-results-close-icon"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Summary Stats */}
        <div className="p-6 pb-3 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl text-center">
              <span className="text-[11px] text-slate-500 font-medium block">Tổng số mục</span>
              <strong className="text-base text-slate-900 font-bold" data-testid="bulk-total-count">
                {result.total_count}
              </strong>
            </div>
            <div className="p-3 bg-emerald-50 border border-emerald-200/80 rounded-xl text-center">
              <span className="text-[11px] text-emerald-700 font-medium block">Thành công</span>
              <strong
                className="text-base text-emerald-700 font-bold"
                data-testid="bulk-success-count"
              >
                {result.success_count}
              </strong>
            </div>
            <div className="p-3 bg-rose-50 border border-rose-200/80 rounded-xl text-center">
              <span className="text-[11px] text-rose-700 font-medium block">Thất bại</span>
              <strong
                className="text-base text-rose-700 font-bold"
                data-testid="bulk-failure-count"
              >
                {result.failure_count}
              </strong>
            </div>
          </div>

          {/* PARTIAL FAILURE BANNER */}
          {isPartial && (
            <div
              className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between gap-3 text-xs text-amber-900"
              data-testid="bulk-partial-failure-banner"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  <strong>Hoàn tất một phần:</strong> Có {result.failure_count} mục không thể thực
                  hiện. Bạn có thể thử lại riêng các mục thất bại này.
                </span>
              </div>
              <button
                type="button"
                onClick={() => onRetryFailed(result.failed_ids)}
                className="btn-primary text-xs py-1.5 px-3 bg-amber-600 hover:bg-amber-700 text-white shrink-0 flex items-center gap-1.5 cursor-pointer"
                data-testid="bulk-retry-failed-btn"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Thử lại ({result.failure_count})</span>
              </button>
            </div>
          )}

          {/* ALL SUCCESS BANNER */}
          {isAllSuccess && (
            <div
              className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2 text-xs text-emerald-800"
              data-testid="bulk-success-banner"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Tất cả {result.success_count} mục đã được thực thi thành công!</span>
            </div>
          )}
        </div>

        {/* Detailed Per-Item List */}
        <div className="px-6 py-2 flex-1 overflow-y-auto space-y-2">
          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Chi tiết từng mục ({result.results.length})
          </h4>

          <div className="space-y-2 divide-y divide-slate-100">
            {result.results.map((item) => {
              const label = itemLabels[item.id] || item.id;
              const isSuccess = item.status === BulkItemStatus.SUCCEEDED;

              return (
                <div
                  key={item.id}
                  className="pt-2 flex items-start justify-between gap-3 text-xs"
                  data-testid={`bulk-result-row-${item.id}`}
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900">{label}</span>
                      <span className="font-mono text-[10px] text-slate-400">({item.id})</span>
                    </div>

                    {!isSuccess && item.error && (
                      <div className="flex items-start gap-1.5 text-rose-700 text-[11px] mt-0.5">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-600" />
                        <div>
                          <span
                            className="font-mono font-bold px-1 py-0.2 rounded bg-rose-100 text-rose-800 mr-1.5 text-[10px]"
                            data-testid={`bulk-error-code-${item.id}`}
                          >
                            {item.error.code}
                          </span>
                          <span>{formatBulkErrorMessage(item.error.code, item.error.message)}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="shrink-0">
                    {isSuccess ? (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800"
                        data-testid={`bulk-result-badge-success-${item.id}`}
                      >
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        <span>Thành công</span>
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-800"
                        data-testid={`bulk-result-badge-failed-${item.id}`}
                      >
                        <AlertCircle className="w-3 h-3 text-rose-600" />
                        <span>Thất bại</span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-3">
          {hasExport ? (
            <button
              type="button"
              onClick={handleDownloadCsv}
              className="btn-secondary text-xs px-3.5 py-1.5 flex items-center gap-1.5 text-blue-600 hover:text-blue-700 border-blue-200 bg-white"
              data-testid="bulk-download-csv-btn"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Tải Tệp CSV ({result.success_count} dòng)</span>
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            {isPartial && (
              <button
                type="button"
                onClick={() => onRetryFailed(result.failed_ids)}
                className="btn-primary text-xs px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1.5"
                data-testid="bulk-retry-failed-footer-btn"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Thử lại mục lỗi ({result.failed_ids.length})</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary text-xs px-4 py-2"
              data-testid="bulk-results-close-btn"
            >
              Đóng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
