'use client';

import React from 'react';
import {
  CheckCircle,
  Ban,
  Sliders,
  Download,
  X,
  Loader2,
  ShieldAlert,
  AlertTriangle,
} from 'lucide-react';
import {
  BulkEntityType,
  BulkActionType,
  hasBulkActionPermission,
  resolveRequiredBulkPermission,
} from './bulk-types';

export interface BulkActionBarProps {
  entityType: string;
  selectedCount: number;
  totalCount: number;
  userPermissions?: string[] | null;
  isUserKnown?: boolean;
  loading?: boolean;
  progressText?: string;
  actionError?: string | null;
  onActionClick: (action: string) => void;
  onClearSelection: () => void;
  onClearError?: () => void;
}

export const BulkActionBar: React.FC<BulkActionBarProps> = ({
  entityType,
  selectedCount,
  totalCount,
  userPermissions = [],
  isUserKnown = false,
  loading = false,
  progressText,
  actionError = null,
  onActionClick,
  onClearSelection,
  onClearError,
}) => {
  if (selectedCount <= 0) return null;

  // UI edit rights strictly derived from permissions, never hardcoded role names (Rule 9)
  // Unknown user means no edit rights
  const canPerformBulk = hasBulkActionPermission(userPermissions, entityType, isUserKnown);
  const requiredPerm = resolveRequiredBulkPermission(entityType);

  return (
    <div
      role="region"
      aria-label="Thanh tác vụ hàng loạt"
      className="sticky bottom-4 z-40 bg-slate-900/95 backdrop-blur-md text-white rounded-xl shadow-2xl p-3 sm:p-4 border border-slate-800 flex flex-col gap-2.5 animate-in fade-in slide-in-from-bottom-2 duration-200"
      data-testid="bulk-action-bar"
    >
      {actionError && (
        <div
          role="alert"
          data-testid="bulk-action-error"
          className="w-full bg-rose-950/80 border border-rose-500/50 text-rose-200 text-xs p-2.5 rounded-lg flex items-center justify-between gap-2 animate-in fade-in"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{actionError}</span>
          </div>
          {onClearError && (
            <button
              type="button"
              onClick={onClearError}
              aria-label="Đóng thông báo lỗi"
              className="text-rose-400 hover:text-rose-200 p-0.5 rounded cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 w-full">
        {/* Selection Info & In-Flight Progress */}
        <div className="flex items-center gap-3">
          <span
            className="bg-blue-600/30 text-blue-300 border border-blue-500/40 px-2.5 py-1 rounded-full text-xs font-bold"
            data-testid="bulk-selected-count"
          >
            Đã chọn {selectedCount} / {totalCount} mục
          </span>

          {loading && (
            <div
              className="flex items-center gap-1.5 text-xs text-amber-300 font-medium"
              data-testid="bulk-in-flight-progress"
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>{progressText || 'Đang thực thi hàng loạt...'}</span>
            </div>
          )}

          {!canPerformBulk && (
            <div
              className="flex items-center gap-1 text-[11px] text-amber-400"
              data-testid="bulk-forbidden-warning"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>
                Yêu cầu quyền <code>{requiredPerm}</code> để thực thi
              </span>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* ACTIVATE */}
          <button
            type="button"
            onClick={() => onActionClick(BulkActionType.ACTIVATE)}
            disabled={loading || !canPerformBulk}
            title={
              canPerformBulk
                ? 'Kích hoạt các mục đã chọn'
                : `Cần quyền ${requiredPerm} để kích hoạt hàng loạt`
            }
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30 border border-emerald-500/30 flex items-center gap-1.5 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            data-testid="bulk-action-activate"
          >
            <CheckCircle className="w-3.5 h-3.5" />
            <span>Kích Hoạt ({selectedCount})</span>
          </button>

          {/* DEACTIVATE (Destructive confirmation required) */}
          <button
            type="button"
            onClick={() => onActionClick(BulkActionType.DEACTIVATE)}
            disabled={loading || !canPerformBulk}
            title={
              canPerformBulk
                ? 'Tạm ngưng các mục đã chọn (thao tác phá hủy - cần xác nhận)'
                : `Cần quyền ${requiredPerm} để tạm ngưng hàng loạt`
            }
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600/20 text-rose-300 hover:bg-rose-600/30 border border-rose-500/30 flex items-center gap-1.5 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            data-testid="bulk-action-deactivate"
          >
            <Ban className="w-3.5 h-3.5" />
            <span>Tạm Ngưng ({selectedCount})</span>
          </button>

          {/* ASSIGN SCOPES (Users only) */}
          {entityType === BulkEntityType.USERS && (
            <button
              type="button"
              onClick={() => onActionClick(BulkActionType.ASSIGN_SCOPES)}
              disabled={loading || !canPerformBulk}
              title={
                canPerformBulk
                  ? 'Gán phạm vi chi nhánh và kho cho các nhân sự đã chọn'
                  : `Cần quyền ${requiredPerm} để gán phạm vi hàng loạt`
              }
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 border border-blue-500/30 flex items-center gap-1.5 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              data-testid="bulk-action-assign_scopes"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Gán Phạm Vi</span>
            </button>
          )}

          {/* EXPORT CSV */}
          <button
            type="button"
            onClick={() => onActionClick(BulkActionType.EXPORT_CSV)}
            disabled={loading || !canPerformBulk}
            title={
              canPerformBulk
                ? 'Xuất dữ liệu các dòng đã chọn ra tệp CSV (RFC 4180)'
                : `Cần quyền ${requiredPerm} để xuất CSV hàng loạt`
            }
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700 flex items-center gap-1.5 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            data-testid="bulk-action-export_csv"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Xuất CSV</span>
          </button>

          {/* DESELECT ALL */}
          <button
            type="button"
            onClick={onClearSelection}
            disabled={loading}
            aria-label="Bỏ chọn tất cả"
            title="Bỏ chọn tất cả các dòng"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition disabled:opacity-50 cursor-pointer ml-1"
            data-testid="bulk-deselect-btn"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
