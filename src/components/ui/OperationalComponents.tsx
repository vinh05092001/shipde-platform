'use client';

import React, { useState } from 'react';
import { Copy, Check, Info, ShieldAlert, AlertTriangle } from 'lucide-react';
import { ShipmentStatus, CarrierCapabilityTier } from '@/types/domain';

// ============================================================================
// 1. Money Component
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
    stateStyle += 'text-slate-400 italic';
  } else if (state === 'estimated') {
    stateStyle += 'text-slate-500 italic';
  }

  return (
    <span className={`${stateStyle} ${className}`} title={state !== 'confirmed' ? `Trạng thái: ${state}` : undefined}>
      {signStr}{formatted}
    </span>
  );
};

// ============================================================================
// 2. TrackingCode Component
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
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <span
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 font-mono text-[12px] font-bold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer group select-all ${className}`}
      title="Bấm để sao chép hoặc mở chi tiết"
    >
      <span>{code}</span>
      <button
        type="button"
        onClick={handleCopy}
        className="text-slate-400 hover:text-slate-700 p-0.5 rounded transition"
        title="Sao chép mã"
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
// 3. StatusBadge Component
// ============================================================================
interface StatusBadgeProps {
  status: ShipmentStatus | string;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className = '' }) => {
  const s = String(status).toUpperCase();

  let badgeClass = 'badge-muted';
  let label = status;
  let dotColor = 'bg-slate-400';

  if (s === 'DELIVERED' || s === 'RESOLVED' || s === 'MATCHED' || s === 'ACCEPTED' || s === 'ACTIVE') {
    badgeClass = 'badge-ok';
    dotColor = 'bg-emerald-500';
    if (s === 'DELIVERED') label = 'Giao Thành Công';
    else if (s === 'RESOLVED') label = 'Đã Đối Soát';
    else if (s === 'MATCHED') label = 'Đã Ghép Mã';
    else if (s === 'ACCEPTED') label = 'Đã Chấp Thuận';
  } else if (s === 'OUT_FOR_DELIVERY') {
    badgeClass = 'badge-warn';
    dotColor = 'bg-amber-500';
    label = 'Đang Giao Hàng';
  } else if (s === 'IN_TRANSIT') {
    badgeClass = 'badge-info';
    dotColor = 'bg-sky-500';
    label = 'Đang Trung Chuyển';
  } else if (s === 'PICKED' || s === 'READY_TO_PICK' || s === 'CREATED') {
    badgeClass = 'badge-info';
    dotColor = 'bg-indigo-500';
    label = s === 'PICKED' ? 'Đã Lấy Hàng' : 'Chờ Lấy Hàng';
  } else if (s === 'RETURNING') {
    badgeClass = 'badge-warn';
    dotColor = 'bg-amber-500';
    label = 'Đang Chuyển Hoàn';
  } else if (s === 'RETURNED') {
    badgeClass = 'badge-muted';
    dotColor = 'bg-slate-500';
    label = 'Đã Nhập Hoàn Kho';
  } else if (s === 'DRAFT') {
    badgeClass = 'badge-muted';
    dotColor = 'bg-slate-400';
    label = 'Bản Nháp';
  } else if (s === 'CANCELLED') {
    badgeClass = 'badge-muted';
    dotColor = 'bg-slate-400';
    label = 'Đã Hủy';
  } else if (s.includes('FAIL') || s.includes('DISPUTE') || s.includes('REJECTED') || s.includes('DAMAGED') || s.includes('LOST') || s.startsWith('D')) {
    badgeClass = 'badge-risk';
    dotColor = 'bg-rose-500';
    if (s === 'DELIVERY_FAIL') label = 'Giao Thất Bại';
    else if (s === 'DISPUTED') label = 'Đang Khiếu Nại';
    else if (s === 'DAMAGED') label = 'Hàng Hư Hỏng';
    else if (s === 'LOST') label = 'Thất Lạc Hàng';
    else if (s === 'D1_WEIGHT') label = 'Lệch Cân Tính Phí (D1)';
    else if (s === 'D2_FREIGHT') label = 'Lệch Cước Hợp Đồng (D2)';
    else if (s === 'D4_DUPLICATE' || s.includes('D4')) label = 'Trừ Cước Trùng (D4)';
    else if (s === 'D5_COD_MISMATCH' || s.includes('D5')) label = 'Lệch Tiền COD (D5)';
    else if (s === 'D6_OVERDUE_COD' || s.includes('D6')) label = 'COD Quá Hạn (D6)';
    else if (s === 'D7_MISSING' || s.includes('D7')) label = 'Thiếu Dòng Sao Kê (D7)';
  } else if (s.includes('DELAY') || s.includes('PENDING') || s.includes('OPEN') || s.includes('ASSIGNED') || s.includes('SUBMITTED')) {
    badgeClass = 'badge-warn';
    dotColor = 'bg-amber-500';
    if (s === 'PICKUP_DELAY') label = 'Chậm Lấy Hàng';
    else if (s === 'OPEN') label = 'Chờ Xử Lý';
    else if (s === 'ASSIGNED') label = 'Đã Phân Công';
    else if (s === 'SUBMITTED') label = 'Đã Gửi Hãng';
    else if (s === 'PENDING') label = 'Chờ Duyệt';
  } else if (s.includes('REATTEMPT')) {
    badgeClass = 'badge-info';
    dotColor = 'bg-sky-500';
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
// 4. AutomationBadge Component
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
      <span className={`badge-ok font-mono font-bold ${className}`} title="Thực thi tự động qua Open API hãng">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span>{carrierCode ? `${carrierCode} · ` : ''}L2 API</span>
      </span>
    );
  }

  if (t === 'L1' || t.includes('ASSIST')) {
    return (
      <span className={`badge-warn font-mono font-bold ${className}`} title="Tạo hồ sơ hỗ trợ — Shop dán cổng hãng">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        <span>{carrierCode ? `${carrierCode} · ` : ''}L1 Assist</span>
      </span>
    );
  }

  return (
    <span className={`badge-muted font-mono ${className}`} title="Thực hiện thủ công tại cổng hãng">
      <span>{carrierCode ? `${carrierCode} · ` : ''}L0 Portal</span>
    </span>
  );
};

// ============================================================================
// 5. EmptyState Component
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
    <div className="modern-card p-10 text-center flex flex-col items-center justify-center space-y-3">
      <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center text-xl">
        {icon || <Info className="w-6 h-6 text-slate-400" />}
      </div>
      <div className="space-y-1 max-w-sm">
        <h4 className="font-bold text-slate-900 text-sm">{title}</h4>
        <p className="text-xs text-slate-500">{description || reason}</p>
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
// 6. ConfirmDialog Component
// ============================================================================
interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  requireReason?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  description,
  requireReason = true,
  confirmLabel = 'Xác nhận',
  cancelLabel = 'Hủy bỏ',
  onConfirm,
  onClose,
}) => {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (requireReason && (!reason || reason.trim().length < 5)) {
      setError('Bắt buộc nhập lý do giải trình tối thiểu 5 ký tự (Quy tắc kiểm toán BR-22).');
      return;
    }
    setError(null);
    onConfirm(reason);
  };

  return (
    <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-in zoom-in-95 duration-150">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 border border-amber-200/60">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-sm">{title}</h3>
            <p className="text-xs text-slate-500 mt-1">{description}</p>
          </div>
        </div>

        {requireReason && (
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1.5">
              Lý do giải trình nghiệp vụ (Bắt buộc theo BR-22):
            </label>
            <textarea
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Nhập lý do xử lý để lưu vết audit..."
              className="modern-input w-full text-xs h-20 resize-none"
              autoFocus
            />
            {error && <p className="text-[11px] text-rose-600 font-semibold mt-1">{error}</p>}
          </div>
        )}

        <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-100">
          <button type="button" onClick={onClose} className="btn-secondary">
            {cancelLabel}
          </button>
          <button type="button" onClick={handleConfirm} className="btn-primary">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
