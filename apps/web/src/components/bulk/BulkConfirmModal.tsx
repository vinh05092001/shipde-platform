'use client';

import React from 'react';
import { AlertTriangle, X, Loader2 } from 'lucide-react';
import { BulkEntityType } from './bulk-types';

export interface BulkConfirmModalProps {
  isOpen: boolean;
  entityType: string;
  action: string;
  selectedCount: number;
  loading?: boolean;
  errorMessage?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export const BulkConfirmModal: React.FC<BulkConfirmModalProps> = ({
  isOpen,
  entityType,
  action,
  selectedCount,
  loading = false,
  errorMessage = null,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  const getEntityLabel = () => {
    switch (entityType) {
      case BulkEntityType.USERS:
        return 'nhân sự';
      case BulkEntityType.BRANCHES:
        return 'chi nhánh';
      case BulkEntityType.WAREHOUSES:
        return 'kho hàng';
      default:
        return 'mục';
    }
  };

  const getWarningExplanation = () => {
    switch (entityType) {
      case BulkEntityType.USERS:
        return 'Tất cả phiên đăng nhập trên thiết bị của các nhân sự này sẽ bị thu hồi ngay lập tức. Để bảo vệ an toàn hệ thống, bạn không thể tự tạm ngưng tài khoản của chính mình và không thể tạm ngưng Chủ Shop (OWNER) duy nhất.';
      case BulkEntityType.BRANCHES:
        return 'Các chi nhánh này sẽ ngừng tiếp nhận đơn hàng mới từ các kênh bán hàng. Chi nhánh mặc định của cửa hàng sẽ luôn được bảo vệ và giữ nguyên.';
      case BulkEntityType.WAREHOUSES:
        return 'Các kho hàng này sẽ ngừng phục vụ xuất kho hoặc quét hàng hoàn. Kho hàng mặc định của cửa hàng sẽ luôn được bảo vệ và giữ nguyên.';
      default:
        return 'Thao tác này sẽ thay đổi trạng thái hoạt động của các mục đã chọn trong phạm vi cửa hàng.';
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-confirm-title"
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
      data-testid="bulk-confirm-modal"
    >
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 flex items-start justify-between border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3
                id="bulk-confirm-title"
                className="text-base font-bold text-slate-900"
                data-testid="bulk-confirm-title"
              >
                Xác nhận tạm ngưng hàng loạt
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Thao tác ảnh hưởng đến {selectedCount} {getEntityLabel()}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            aria-label="Đóng hộp thoại xác nhận"
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {errorMessage && (
            <div
              role="alert"
              data-testid="bulk-modal-error"
              className="p-3 bg-rose-50 border border-rose-300 rounded-xl text-xs text-rose-800 font-medium flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Không thể thực thi thao tác</p>
                <p>{errorMessage}</p>
              </div>
            </div>
          )}

          <div className="p-3.5 bg-rose-50 border border-rose-200/80 rounded-xl space-y-1.5">
            <p className="text-xs font-bold text-rose-800">
              Bạn có chắc chắn muốn tạm ngưng {selectedCount} {getEntityLabel()} đã chọn?
            </p>
            <p className="text-[11px] text-rose-700 leading-relaxed">{getWarningExplanation()}</p>
          </div>

          <p className="text-xs text-slate-600">
            Hệ thống sẽ thực thi độc lập từng mục và báo cáo trung thực kết quả chi tiết kèm mã lỗi
            chuẩn.
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="btn-secondary text-xs px-4 py-2"
            data-testid="bulk-confirm-cancel"
          >
            Hủy Bỏ
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="btn-primary text-xs px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-1.5 border-rose-600 cursor-pointer"
            data-testid="bulk-confirm-submit"
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>Xác Nhận Tạm Ngưng</span>
          </button>
        </div>
      </div>
    </div>
  );
};
