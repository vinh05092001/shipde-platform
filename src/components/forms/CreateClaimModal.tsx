'use client';

import React, { useState } from 'react';
import { FileText, X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onClaimCreated: (claim: any) => void;
}

export const CreateClaimModal: React.FC<Props> = ({ isOpen, onClose, onClaimCreated }) => {
  const [trackingCode, setTrackingCode] = useState('GHN88290500');
  const [claimType, setClaimType] = useState('FEE');
  const [amount, setAmount] = useState('35000');
  const [reason, setReason] = useState('Khấu trừ cước sai biểu giá hợp đồng cam kết');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch('/api/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tracking_code: trackingCode,
          claim_type: claimType,
          requested_amount: Number(amount),
          carrier_ticket: `TK-${Date.now().toString().slice(-6)}`,
          reason,
        }),
      });

      const data = await res.json();
      onClaimCreated(data.data);
      onClose();
    } catch (err: any) {
      alert(err.message);
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
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900">Tạo Hồ Sơ Khiếu Nại Hãng (CN-16)</h3>
              <p className="text-[11px] text-slate-500">Tự động tập hợp chứng cứ và giám sát thời hiệu 48h (BR-37)</p>
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

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="font-bold text-slate-700 block mb-1">Mã Vận Đơn Cần Đòi Tiền:</label>
            <input
              type="text"
              value={trackingCode}
              onChange={(e) => setTrackingCode(e.target.value)}
              className="modern-input w-full font-mono uppercase font-bold text-xs"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-bold text-slate-700 block mb-1">Loại Khiếu Nại:</label>
              <select
                value={claimType}
                onChange={(e) => setClaimType(e.target.value)}
                className="modern-input w-full text-xs font-semibold"
              >
                <option value="FEE">Lệch cước hợp đồng</option>
                <option value="DAMAGED">Hàng hoàn bị hư hỏng</option>
                <option value="LOST">Thất lạc bưu kiện</option>
                <option value="COD">Lệch tiền COD</option>
              </select>
            </div>

            <div>
              <label className="font-bold text-slate-700 block mb-1">Số Tiền Yêu Cầu (VND):</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="modern-input w-full font-mono font-bold text-xs"
                required
              />
            </div>
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1">Lý Do Chi Tiết & Bằng Chứng:</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
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
              {loading ? 'Đang tạo...' : 'Khởi Tạo Hồ Sơ'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
