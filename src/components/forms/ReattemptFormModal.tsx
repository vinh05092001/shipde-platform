'use client';

import React, { useState } from 'react';
import { Send, X, Phone, Calendar, Clock, AlertTriangle, ShieldCheck } from 'lucide-react';
import { AutomationBadge } from '../ui/OperationalComponents';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  exceptionItem: any;
  carrierGhnTier: 'L2' | 'L1';
  onReattemptDispatched: (result: any) => void;
}

export const ReattemptFormModal: React.FC<Props> = ({
  isOpen,
  onClose,
  exceptionItem,
  carrierGhnTier,
  onReattemptDispatched,
}) => {
  const [scheduledDate, setScheduledDate] = useState('2026-08-18');
  const [note, setNote] = useState('Khách hẹn giao lại ca chiều');
  const [newPhone, setNewPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen || !exceptionItem) return null;

  const currentTier = exceptionItem.carrier_code === 'GHN' ? carrierGhnTier : 'L1';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/exceptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'DISPATCH_REATTEMPT',
          exception_id: exceptionItem.id,
          tracking_code: exceptionItem.tracking_code,
          carrier_code: exceptionItem.carrier_code,
          scheduled_date: scheduledDate,
          note,
          new_phone: newPhone || undefined,
          user_id: 'usr_02',
          user_name: 'Trần Thị Hoa (CSKH)',
          current_version: exceptionItem.version || 1,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Lỗi gửi yêu cầu giao lại');
      }

      onReattemptDispatched(data.data);
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
              <Send className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-slate-900">Gửi Lệnh Giao Lại / Đổi SĐT</h3>
                <AutomationBadge tier={currentTier as any} carrierCode={exceptionItem.carrier_code} />
              </div>
              <p className="text-[11px] text-slate-500 font-mono">Mã: {exceptionItem.tracking_code}</p>
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

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="font-bold text-slate-700 block mb-1">Số Điện Thoại Mới (Nếu khách đổi):</label>
            <input
              type="tel"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="0912345678"
              className="modern-input w-full font-mono text-xs"
            />
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1">Ngày Hẹn Giao Lại:</label>
            <input
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              className="modern-input w-full text-xs font-semibold"
              required
            />
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1">Ghi Chú Cho Shipper:</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="modern-input w-full text-xs h-16 resize-none"
              required
            />
          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary text-xs"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary text-xs"
            >
              {loading
                ? 'Đang gửi...'
                : currentTier === 'L2'
                ? 'Bắn Lệnh Giao Lại (L2 API)'
                : 'Tạo Hồ Sơ Hỗ Trợ (L1 Assist)'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
