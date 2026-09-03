'use client';

import React, { useState } from 'react';
import { Copy, Check, Info, ShieldAlert, AlertTriangle, ExternalLink } from 'lucide-react';
import { ShipmentStatus, CarrierCapabilityTier } from '@/types/domain';

// ============================================================================
// 1. Money Component (Tabular Figures, Precise Formatting)
// ============================================================================
interface MoneyProps {
  amount: number | bigint;
  state?: 'confirmed' | 'pending' | 'estimated';
  showSign?: boolean;
  className?: string;
}

export const Money: React.FC<MoneyProps> = ({
  amount,
  state = 'confirmed',
  showSign = false,
  className = '',
}) => {
  const num = Number(amount) || 0;
  const isNegative = num < 0;
  const absNum = Math.abs(num);
  const formatted = absNum.toLocaleString('vi-VN') + ' đ';

  const signStr = isNegative ? '- ' : showSign && num > 0 ? '+ ' : '';

  let stateStyle = 'font-mono tabular-nums text-right ';
  if (state === 'confirmed') {
    stateStyle += isNegative ? 'text-rose-600 font-bold' : 'text-slate-900 font-semibold';
  } else if (state === 'pending') {
    stateStyle += 'text-slate-500 italic';
  } else if (state === 'estimated') {
    stateStyle += 'text-slate-500 italic';
  }

  return (
    <span
      className={`${stateStyle} ${className}`}
      title={state !== 'confirmed' ? `Trạng thái: ${state}` : undefined}
    >
      {signStr}
      {formatted}
    </span>
  );
};

// ============================================================================
// 2. TrackingCode Component (1-Touch Copy with Immediate Visual Feedback)
// ============================================================================
interface TrackingCodeProps {
  code: string;
  onClick?: () => void;
  className?: string;
}

export const TrackingCode: React.FC<TrackingCodeProps> = ({ code, onClick, className = '' }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <span
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 font-mono text-[13px] font-bold text-slate-900 hover:text-[#EA4B12] cursor-pointer group select-all transition-colors ${className}`}
      title="Bấm để sao chép hoặc mở chi tiết hành trình"
    >
      <span>{code}</span>
      <button
        type="button"
        onClick={handleCopy}
        className="text-slate-400 hover:text-[#EA4B12] p-1 rounded-md transition"
        title={copied ? 'Đã sao chép mã' : 'Sao chép mã'}
      >
        {copied ? (
          <Check className="w-3.5 h-3.5 text-emerald-600" />
        ) : (
          <Copy className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </button>
    </span>
  );
};

// ============================================================================
// 3. StatusBadge Component (Vietnamese Business Language)
// ============================================================================
interface StatusBadgeProps {
  status: ShipmentStatus | string;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className = '' }) => {
  const s = String(status).toUpperCase();

  let badgeClass = 'badge-info';
  let label = status;
  let dotColor = 'bg-slate-400';

  if (
    s === 'DELIVERED' ||
    s === 'RESOLVED' ||
    s === 'MATCHED' ||
    s === 'ACCEPTED' ||
    s === 'ACTIVE'
  ) {
    badgeClass = 'badge-ok';
    dotColor = 'bg-emerald-600';
    if (s === 'DELIVERED') label = 'Giao Thành Công';
    else if (s === 'RESOLVED') label = 'Đã Đối Soát';
    else if (s === 'MATCHED') label = 'Đã Khớp Mã';
    else if (s === 'ACCEPTED') label = 'Hãng Đã Chấp Thuận';
  } else if (s === 'OUT_FOR_DELIVERY') {
    badgeClass = 'badge-warn';
    dotColor = 'bg-amber-600';
    label = 'Đang Giao Hàng';
  } else if (s === 'IN_TRANSIT') {
    badgeClass = 'badge-info';
    dotColor = 'bg-slate-500';
    label = 'Đang Trung Chuyển';
  } else if (s === 'PICKING' || s === 'PICKED' || s === 'READY_TO_PICK' || s === 'CREATED') {
    badgeClass = 'badge-info';
    dotColor = 'bg-slate-500';
    label = s === 'PICKED' ? 'Đã Lấy Hàng' : 'Chờ Lấy Hàng';
  } else if (s === 'RETURNING') {
    badgeClass = 'badge-warn';
    dotColor = 'bg-amber-600';
    label = 'Đang Chuyển Hoàn';
  } else if (s === 'RETURNED') {
    badgeClass = 'badge-info';
    dotColor = 'bg-slate-600';
    label = 'Đã Nhập Hoàn Kho';
  } else if (s === 'DRAFT') {
    badgeClass = 'badge-info';
    dotColor = 'bg-slate-400';
    label = 'Bản Nháp';
  } else if (s === 'CANCELLED') {
    badgeClass = 'badge-info';
    dotColor = 'bg-slate-400';
    label = 'Đã Hủy';
  } else if (
    s.includes('FAIL') ||
    s.includes('DISPUTE') ||
    s.includes('REJECTED') ||
    s.includes('DAMAGED') ||
    s.includes('LOST') ||
    s.startsWith('D')
  ) {
    badgeClass = 'badge-risk';
    dotColor = 'bg-rose-600';
    if (s === 'DELIVERY_FAIL') label = 'Giao Thất Bại';
    else if (s === 'DISPUTED') label = 'Đang Khiếu Nại';
    else if (s === 'DAMAGED') label = 'Hàng Hư Hỏng';
    else if (s === 'LOST') label = 'Thất Lạc Hàng';
    else if (s === 'D1_WEIGHT') label = 'Lệch Cân Tính Phí';
    else if (s === 'D2_FREIGHT') label = 'Lệch Cước Hợp Đồng';
    else if (s === 'D4_DUPLICATE' || s.includes('D4')) label = 'Trừ Cước Trùng';
    else if (s === 'D5_COD_MISMATCH' || s.includes('D5')) label = 'Lệch Tiền COD';
    else if (s === 'D6_OVERDUE_COD' || s.includes('D6')) label = 'COD Quá Hạn';
    else if (s === 'D7_MISSING' || s.includes('D7')) label = 'Thiếu Dòng Sao Kê';
  } else if (
    s.includes('DELAY') ||
    s.includes('PENDING') ||
    s.includes('OPEN') ||
    s.includes('ASSIGNED') ||
    s.includes('SUBMITTED')
  ) {
    badgeClass = 'badge-warn';
    dotColor = 'bg-amber-600';
    if (s === 'PICKUP_DELAY') label = 'Chậm Lấy Hàng';
    else if (s === 'OPEN') label = 'Chờ Xử Lý';
    else if (s === 'ASSIGNED') label = 'Đã Phân Công';
    else if (s === 'SUBMITTED') label = 'Đã Gửi Hãng';
    else if (s === 'PENDING') label = 'Chờ Duyệt';
  } else if (s.includes('REATTEMPT')) {
    badgeClass = 'badge-info';
    dotColor = 'bg-emerald-600';
    label = 'Đã Gửi Lệnh Giao Lại';
  }

  return (
    <span className={`${badgeClass} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      <span>{label}</span>
    </span>
  );
};

// ============================================================================
// 4. AutomationBadge Component (Clear Operational Description)
// ============================================================================
interface AutomationBadgeProps {
  tier: CarrierCapabilityTier | 'L2' | 'L1' | 'L0';
  carrierCode?: string;
  className?: string;
}

export const AutomationBadge: React.FC<AutomationBadgeProps> = ({
  tier,
  carrierCode = '',
  className = '',
}) => {
  const t = String(tier).toUpperCase();

  if (t === 'L2' || t.includes('EXECUTE')) {
    return (
      <span
        className={`badge-ok font-semibold text-xs ${className}`}
        title="Tự động gọi API hãng trực tiếp"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
        <span>{carrierCode ? `${carrierCode} · ` : ''}Tự Động Qua API</span>
      </span>
    );
  }

  if (t === 'L1' || t.includes('ASSIST')) {
    return (
      <span
        className={`badge-warn font-semibold text-xs ${className}`}
        title="Tạo hồ sơ chuẩn mẫu để nhân viên dán lên cổng hãng"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-amber-600" />
        <span>{carrierCode ? `${carrierCode} · ` : ''}Hỗ Trợ Cổng Hãng</span>
      </span>
    );
  }

  return (
    <span
      className={`badge-info font-medium text-xs ${className}`}
      title="Thao tác hoàn toàn thủ công"
    >
      <span>{carrierCode ? `${carrierCode} · ` : ''}Thủ Công</span>
    </span>
  );
};

// ============================================================================
// 5. EmptyState Component (Clean & Helpful)
// ============================================================================
interface EmptyStateProps {
  title: string;
  description?: string;
  reason?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  reason,
  actionLabel,
  onAction,
  icon,
}) => {
  return (
    <div className="modern-card p-12 text-center flex flex-col items-center justify-center space-y-3">
      <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center text-xl">
        {icon || <Info className="w-6 h-6 text-slate-400" />}
      </div>
      <div className="space-y-1 max-w-md">
        <h4 className="font-bold text-slate-900 text-sm">{title}</h4>
        {(description || reason) && (
          <p className="text-xs text-slate-500">{description || reason}</p>
        )}
      </div>
      {actionLabel && onAction && (
        <button type="button" onClick={onAction} className="btn-primary mt-2">
          {actionLabel}
        </button>
      )}
    </div>
  );
};

// ============================================================================
// 6. ConfirmDialog Modal (Focus Trapped, Accessible)
// ============================================================================
interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDanger?: boolean;
  requireReason?: boolean;
  onConfirm: (reason: string) => void;
  onCancel?: () => void;
  onClose?: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  description,
  confirmLabel = 'Xác Nhận',
  cancelLabel = 'Hủy Bỏ',
  isDanger = false,
  requireReason = false,
  onConfirm,
  onCancel,
  onClose,
}) => {
  const handleClose = () => {
    if (onCancel) onCancel();
    if (onClose) onClose();
  };
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (requireReason && !reason.trim()) {
      setError('Vui lòng nhập lý do giải trình bắt buộc.');
      return;
    }
    setError(null);
    onConfirm(reason);
    setReason('');
  };

  return (
    <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isDanger ? 'bg-rose-50 text-rose-600' : 'bg-[#FFF5F0] text-[#EA4B12]'}`}
          >
            {isDanger ? <ShieldAlert className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-base">{title}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{message}</p>
          </div>
        </div>

        {requireReason && (
          <div className="space-y-1.5 pt-2">
            <label className="text-xs font-bold text-slate-700 block">
              Lý do giải trình (Bắt buộc theo quy tắc tài chính):
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Nhập chi tiết căn cứ giải trình..."
              className="modern-input text-xs h-20 resize-none"
              autoFocus
            />
            {error && <p className="text-xs text-rose-600 font-semibold">{error}</p>}
          </div>
        )}

        <div className="flex justify-end items-center gap-2 pt-3 border-t border-slate-100">
          <button type="button" onClick={onCancel} className="btn-secondary text-xs">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className={isDanger ? 'btn-danger text-xs' : 'btn-primary text-xs'}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
