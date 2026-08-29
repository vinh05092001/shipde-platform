'use client';

import React, { useState } from 'react';
import { UIDiscrepancyItem } from './types';
import { MASTER_DISCREPANCIES } from '@/services/unifiedDataStore';
import {
  TrackingCode,
  Money,
  StatusBadge,
  AutomationBadge,
  ConfirmDialog,
} from './ui/OperationalComponents';
import { DiscrepancyType, DiscrepancyResolution } from '@/types/domain';
import {
  DollarSign,
  Upload,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  Lock,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  ArrowRight,
  Filter,
  Check,
} from 'lucide-react';

interface Props {
  discrepancies?: UIDiscrepancyItem[];
  onUpdateDiscrepancy?: (updated: UIDiscrepancyItem) => void;
  role?: string;
  onOpenUpload?: () => void;
}

export const ReconciliationTab: React.FC<Props> = ({
  discrepancies = MASTER_DISCREPANCIES,
  onUpdateDiscrepancy,
  role = 'OWNER',
  onOpenUpload,
}) => {
  const [items, setItems] = useState<UIDiscrepancyItem[]>(discrepancies);
  const [selectedDiscrepancyType, setSelectedDiscrepancyType] = useState<string>('ALL');
  const [resolvingItem, setResolvingItem] = useState<UIDiscrepancyItem | null>(null);
  const [resolvingAction, setResolvingAction] = useState<DiscrepancyResolution>(
    DiscrepancyResolution.DISPUTE
  );
  const [isPeriodClosed, setIsPeriodClosed] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const statementSummary = {
    period: 'Kỳ Đối Soát Tuần 33 (10/08/2026 – 16/08/2026)',
    carrier: 'GHN Express & GHTK',
    total_rows: 50,
    total_cod: 14250000,
    total_freight: 1240000,
    matched_exact: 48,
  };

  const openDiscrepancies = items.filter((d) => String(d.status).toUpperCase() === 'OPEN');
  const openCount = openDiscrepancies.length;
  const totalOpenAmount = openDiscrepancies.reduce((sum, d) => sum + d.discrepancy_amount, 0);

  const filteredDiscrepancies = items.filter((d) => {
    if (selectedDiscrepancyType === 'ALL') return true;
    return String(d.type).startsWith(selectedDiscrepancyType);
  });

  const handleResolveAction = (item: UIDiscrepancyItem, action: DiscrepancyResolution) => {
    // Maker-Checker Check
    if (item.created_by_user === 'usr_02' && role === 'OPS_CSKH') {
      alert(
        '[Quy tắc Tách quyền tài chính]: Bạn là nhân viên CSKH đã tạo yêu cầu xử lý đơn này, nên không được quyền tự duyệt chênh lệch. Vui lòng chuyển cho Kế toán viên độc lập duyệt.'
      );
      return;
    }

    setResolvingItem(item);
    setResolvingAction(action);
  };

  const handleConfirmResolution = async (reason: string) => {
    if (!resolvingItem) return;

    const updated: UIDiscrepancyItem = {
      ...resolvingItem,
      status: resolvingAction === DiscrepancyResolution.CONFIRMED ? 'CONFIRMED' : 'RESOLVED',
      reason: reason,
      version: (resolvingItem.version || 1) + 1,
    };

    setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    if (onUpdateDiscrepancy) onUpdateDiscrepancy(updated);

    setToastMessage(`✓ Đã xử lý chênh lệch cho mã ${resolvingItem.tracking_code} thành công.`);
    setResolvingItem(null);
    setTimeout(() => setToastMessage(null), 4000);
  };

  return (
    <div className="w-full space-y-6">
      {toastMessage && (
        <div className="p-3.5 bg-slate-900 text-white rounded-xl text-xs font-semibold flex items-center justify-between shadow-lg border border-slate-700 animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{toastMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="font-bold text-slate-400 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* Statement Summary Card */}
      <div className="modern-card p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-900 text-white border-slate-800">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-white flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-[#EA4B12]" />
              <span>Đối Soát COD, Cước Vận Chuyển & Phụ Phí</span>
            </h1>
            <span className="badge-ok text-xs">Kỳ Mở</span>
          </div>
          <p className="text-xs text-slate-300">
            {statementSummary.period} · {statementSummary.carrier} · Tổng 50 dòng sao kê
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-xs text-slate-400">Tổng COD Đối Soát</div>
            <div className="text-xl font-bold font-mono text-emerald-400">
              <Money
                amount={statementSummary.total_cod}
                state="confirmed"
                className="text-emerald-400 text-xl"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onOpenUpload && (
              <button
                type="button"
                onClick={onOpenUpload}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-800 bg-[#F6F5F3] hover:bg-[#EAE7E4] border border-slate-700 rounded-lg transition cursor-pointer"
                title="Tải lên file sao kê hãng Excel / CSV để đối soát tự động"
              >
                <Upload className="w-3.5 h-3.5 text-[#EA4B12]" />
                <span>Nạp Sao Kê Hãng</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (openCount > 0) {
                  alert(
                    `Không thể chốt kỳ khi còn ${openCount} khoản chênh lệch chưa xử lý. Vui lòng duyệt hoặc chuyển kỳ.`
                  );
                  return;
                }
                setIsPeriodClosed(true);
                setToastMessage(
                  '✓ Đã chốt sổ kỳ đối soát thành công. Dữ liệu đã được khóa bất biến.'
                );
              }}
              disabled={isPeriodClosed}
              className={`btn-primary text-xs ${isPeriodClosed ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <Lock className="w-4 h-4" />
              <span>{isPeriodClosed ? 'Kỳ Đã Khóa' : 'Chốt Kỳ Đối Soát'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Discrepancy Classification Filter Bar */}
      <div className="modern-card p-4 space-y-3">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <div>
            <span className="font-bold text-slate-900 text-sm">
              Danh Sách Khoản Lệch Cần Xử Lý ({openCount} khoản mở)
            </span>
            <span className="text-xs text-slate-500 ml-2">
              Tổng giá trị chênh lệch:{' '}
              <strong className="text-rose-700 font-mono">
                <Money amount={totalOpenAmount} state="confirmed" className="inline" />
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar">
            {[
              { id: 'ALL', label: 'Tất Cả' },
              { id: 'D1', label: 'Lệch Cân' },
              { id: 'D2', label: 'Lệch Cước' },
              { id: 'D4', label: 'Trừ Trùng' },
              { id: 'D5', label: 'Lệch COD' },
              { id: 'D6', label: 'COD Quá Hạn' },
              { id: 'D7', label: 'Thiếu Dòng' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setSelectedDiscrepancyType(f.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  selectedDiscrepancyType === f.id
                    ? 'bg-[#FFF5F0] text-[#EA4B12] font-bold border border-[#FDDDD0]'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Discrepancies Table */}
      <div className="modern-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="modern-table">
            <thead>
              <tr>
                <th>Mã Vận Đơn / Mã Đơn</th>
                <th>Hãng</th>
                <th>Phân Loại Sai Lệch</th>
                <th>Số Liệu Khai Báo vs Sao Kê</th>
                <th className="text-right">Số Tiền Lệch</th>
                <th>Lý Do Chi Tiết</th>
                <th className="text-right">Thao Tác Duyệt</th>
              </tr>
            </thead>
            <tbody>
              {filteredDiscrepancies.map((disc) => {
                const isResolved = disc.status !== 'OPEN';

                return (
                  <tr key={disc.id}>
                    <td>
                      <TrackingCode code={disc.tracking_code} />
                      <div className="text-xs text-slate-500 font-mono mt-0.5">
                        {disc.order_code}
                      </div>
                    </td>

                    <td className="font-bold text-xs text-slate-800">{disc.carrier_code}</td>

                    <td>
                      <StatusBadge status={disc.type} />
                    </td>

                    <td className="text-xs space-y-0.5">
                      <div className="text-slate-500">{disc.declared_value}</div>
                      <div className="font-semibold text-slate-900">{disc.charged_value}</div>
                    </td>

                    <td className="text-right font-mono font-bold text-rose-700 text-sm">
                      <Money amount={disc.discrepancy_amount} state="confirmed" />
                    </td>

                    <td className="text-xs text-slate-600 max-w-xs">{disc.reason}</td>

                    <td className="text-right space-x-1.5">
                      {isResolved ? (
                        <span className="badge-ok text-xs">Đã Xử Lý</span>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              handleResolveAction(disc, DiscrepancyResolution.CONFIRMED)
                            }
                            className="btn-secondary text-xs py-1 px-2.5 font-semibold text-emerald-700"
                          >
                            Chấp Thuận
                          </button>
                          <button
                            type="button"
                            onClick={() => handleResolveAction(disc, DiscrepancyResolution.DISPUTE)}
                            className="btn-primary text-xs py-1 px-2.5"
                          >
                            Khiếu Nại
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Discrepancy Resolution Modal with Mandatory Reason */}
      <ConfirmDialog
        isOpen={!!resolvingItem}
        title={
          resolvingAction === DiscrepancyResolution.CONFIRMED
            ? 'Xác Nhận Chấp Thuận Chênh Lệch'
            : 'Mở Hồ Sơ Khiếu Nại Khoản Lệch'
        }
        message={`Xử lý khoản lệch ${resolvingItem?.discrepancy_amount.toLocaleString('vi-VN')} đ cho mã vận đơn ${resolvingItem?.tracking_code}.`}
        confirmLabel="Xác Nhận Xử Lý"
        cancelLabel="Hủy Bỏ"
        requireReason={true}
        onConfirm={handleConfirmResolution}
        onCancel={() => setResolvingItem(null)}
      />
    </div>
  );
};
