'use client';

import React, { useState } from 'react';
import { ShieldCheck, X, AlertTriangle } from 'lucide-react';
import { DiscrepancyResolution } from '@/types/domain';
import { Money } from '../ui/OperationalComponents';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  discrepancyItem: any;
  role: string;
  onResolved: (result: any) => void;
}

export const ResolveDiscrepancyModal: React.FC<Props> = ({
  isOpen,
  onClose,
  discrepancyItem,
  role,
  onResolved,
}) => {
  const [resolution, setResolution] = useState<DiscrepancyResolution>(
    DiscrepancyResolution.DISPUTE
  );
  const [reason, setReason] = useState('Khấu trừ cước sai biểu giá hợp đồng cam kết');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen || !discrepancyItem) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Maker-Checker Check (BR-12)
    if (discrepancyItem.created_by_user === 'usr_02' && role === 'OPS_CSKH') {
      setErrorMsg(
        '[Quy tắc BR-12]: Bạn là nhân viên CSKH đã xử lý đơn này, nên không được quyền tự duyệt chênh lệch. Vui lòng chuyển cho Kế toán viên độc lập duyệt.'
      );
      return;
    }

    if (!reason || reason.trim().length < 5) {
      setErrorMsg('Bắt buộc nhập lý do giải trình tối thiểu 5 ký tự (BR-22).');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'RESOLVE_DISCREPANCY',
          discrepancy_id: discrepancyItem.id,
          resolution,
          reason,
          user_id: role === 'ACCOUNTANT' ? 'usr_03' : 'usr_01',
          user_name: role === 'ACCOUNTANT' ? 'Lê Minh Kế Toán' : 'Nguyễn Văn An (Chủ Shop)',
          expected_version: discrepancyItem.version || 1,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Lỗi xử lý sai lệch');
      }

      onResolved(data.data);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 shadow-2xl text-xs animate-in zoom-in-95 duration-150">
        <div className="flex justify-between items-center pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900">Duyệt Sai Lệch Đối Soát (BR-12)</h3>
              <p className="text-[11px] text-slate-500 font-mono">
                Mã: {discrepancyItem.tracking_code}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center font-bold text-xs"
          >
            ✕
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-semibold">
            {errorMsg}
          </div>
        )}

        <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-slate-600">Loại sai lệch:</span>
            <strong className="text-slate-900">{discrepancyItem.type}</strong>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Số tiền chênh lệch:</span>
            <strong className="text-rose-600 font-mono font-bold">
              <Money
                amount={discrepancyItem.discrepancy_amount || discrepancyItem.amount || 0}
                state="confirmed"
                showSign
              />
            </strong>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="font-bold text-slate-700 block mb-1">Quyết Định Xử Lý:</label>
            <select
              value={resolution}
              onChange={(e: any) => setResolution(e.target.value)}
              className="modern-input w-full text-xs font-semibold"
            >
              <option value={DiscrepancyResolution.DISPUTE}>
                1. Khởi tạo khiếu nại đòi tiền hãng (DISPUTE)
              </option>
              <option value={DiscrepancyResolution.CONFIRMED}>
                2. Chấp thuận khấu trừ (CONFIRMED)
              </option>
              <option value={DiscrepancyResolution.WAIVE}>3. Bỏ qua chênh lệch nhỏ (WAIVE)</option>
              <option value={DiscrepancyResolution.CARRY_FORWARD}>
                4. Chuyển sang kỳ sau tiếp tục đối chiếu (CARRY_FORWARD)
              </option>
            </select>
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1">
              Lý Do Giải Trình (Bắt Buộc BR-22):
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="modern-input w-full text-xs h-16 resize-none"
              required
            />
          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end gap-2.5">
            <button type="button" onClick={onClose} className="btn-secondary text-xs">
              Hủy
            </button>
            <button type="submit" disabled={loading} className="btn-primary text-xs">
              {loading ? 'Đang lưu...' : 'Xác Nhận Quyết Định'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
