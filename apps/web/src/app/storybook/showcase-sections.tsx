/**
 * Storybook showcase page sections: fixture banners, page actions, state simulator.
 */

'use client';

import type React from 'react';
import Link from 'next/link';
import { Download, Plus, RefreshCw, Sparkles } from 'lucide-react';

interface ShowcaseBannersProps {
  actionFeedback: string | null;
  onDismissFeedback: () => void;
}

export function ShowcaseBanners({ actionFeedback, onDismissFeedback }: ShowcaseBannersProps) {
  return (
    <>
        {/* Fixture Notice Banner (BR-UI-05) */}
        <div className="p-3.5 rounded-[8px] bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-3">
          <Sparkles className="w-5 h-5 text-amber-600 shrink-0" aria-hidden="true" />
          <div className="leading-relaxed">
            <strong className="font-semibold">[DỮ LIỆU THỬ NGHIỆM / FIXTURE DATA]</strong>: Toàn bộ
            danh sách vận đơn, khách hàng, số điện thoại và cước phí trên trang Storybook này là
            fixture mẫu phục vụ kiểm thử và xác thực linh kiện UI, không liên kết API trực tiếp hay
            gọi dữ liệu thật.
          </div>
        </div>

        {/* Action Feedback Notice */}
        {actionFeedback && (
          <div
            role="status"
            aria-live="polite"
            className="p-3 rounded-[8px] bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between gap-2"
          >
            <span>{actionFeedback}</span>
            <button
              type="button"
              onClick={() => onDismissFeedback()}
              title="Đóng thông báo"
              className="text-emerald-700 hover:text-emerald-900 p-0.5 cursor-pointer font-bold"
            >
              ✕
            </button>
          </div>
        )}
    </>
  );
}

interface ShowcaseHeaderActionsProps {
  onExport: () => void;
  onCreate: () => void;
}

export function ShowcaseHeaderActions({ onExport, onCreate }: ShowcaseHeaderActionsProps) {
  return (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onExport}
                title="Xuất file Excel dữ liệu mẫu (Fixture demo)"
                className="btn-secondary !text-xs !min-h-[34px] !py-1.5 !px-3 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Xuất Excel
              </button>
              <button
                type="button"
                onClick={onCreate}
                title="Tạo đơn thử nghiệm mẫu (Fixture demo)"
                className="btn-primary !text-xs !min-h-[34px] !py-1.5 !px-3 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Tạo đơn thử nghiệm
              </button>
            </div>
  );
}

interface StateSimulatorProps {
  loading: boolean;
  empty: boolean;
  error: boolean;
  forbidden: boolean;
  rowCount: number;
  onResetNormal: () => void;
  onToggleLoading: React.Dispatch<React.SetStateAction<boolean>>;
  onToggleEmpty: React.Dispatch<React.SetStateAction<boolean>>;
  onToggleError: React.Dispatch<React.SetStateAction<boolean>>;
  onToggleForbidden: React.Dispatch<React.SetStateAction<boolean>>;
}

export function StateSimulator({
  loading,
  empty,
  error,
  forbidden,
  rowCount,
  onResetNormal,
  onToggleLoading,
  onToggleEmpty,
  onToggleError,
  onToggleForbidden,
}: StateSimulatorProps) {
  return (
    <>
        {/* Interactive State Simulator Bar */}
        <div className="p-4 rounded-[10px] bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Mô phỏng các trạng thái giao diện (UI State Simulation)</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onResetNormal}
              className={`px-3 py-1.5 rounded-[6px] text-xs font-medium border cursor-pointer transition-colors ${
                !loading && !error && !empty && !forbidden
                  ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                  : 'bg-[var(--bg-app)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)]'
              }`}
            >
              Trạng thái bình thường ({rowCount} dòng)
            </button>

            <button
              type="button"
              onClick={() => onToggleLoading((prev) => !prev)}
              className={`px-3 py-1.5 rounded-[6px] text-xs font-medium border cursor-pointer transition-colors ${
                loading
                  ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                  : 'bg-[var(--bg-app)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)]'
              }`}
            >
              {loading ? 'Đang bật Skeleton (Nhấn để tắt)' : 'Mô phỏng Loading Skeleton'}
            </button>

            <button
              type="button"
              onClick={() => onToggleEmpty((prev) => !prev)}
              className={`px-3 py-1.5 rounded-[6px] text-xs font-medium border cursor-pointer transition-colors ${
                empty
                  ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                  : 'bg-[var(--bg-app)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)]'
              }`}
            >
              {empty ? 'Đang bật Empty (Nhấn để tắt)' : 'Mô phỏng Trạng thái Trống (Empty)'}
            </button>

            <button
              type="button"
              onClick={() => onToggleError((prev) => !prev)}
              className={`px-3 py-1.5 rounded-[6px] text-xs font-medium border cursor-pointer transition-colors ${
                error
                  ? 'bg-[var(--status-risk-text)] text-white border-[var(--status-risk-border)]'
                  : 'bg-[var(--bg-app)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)]'
              }`}
            >
              {error
                ? 'Đang bật Error (Nhấn để tắt)'
                : 'Mô phỏng Trạng thái Lỗi (Error 500)'}
            </button>

            <button
              type="button"
              onClick={() => onToggleForbidden((prev) => !prev)}
              className={`px-3 py-1.5 rounded-[6px] text-xs font-medium border cursor-pointer transition-colors ${
                forbidden
                  ? 'bg-[var(--status-risk-text)] text-white border-[var(--status-risk-border)]'
                  : 'bg-[var(--bg-app)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)]'
              }`}
            >
              {forbidden ? 'Đang bật Cấm (Nhấn để tắt)' : 'Mô phỏng Bị cấm (Forbidden 403)'}
            </button>

            <Link
              href="/storybook?search=N"
              className="px-3 py-1.5 rounded-[6px] text-xs font-medium border cursor-pointer transition-colors bg-[var(--bg-app)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)]"
            >
              Mô phỏng điều hướng ngoài: search=N
            </Link>
          </div>
        </div>
    </>
  );
}
