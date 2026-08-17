'use client';

import React, { useState } from 'react';
import { Scale, X } from 'lucide-react';
import { Money } from '../ui/OperationalComponents';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (rateCard: any) => void;
}

export const RateCardFormModal: React.FC<Props> = ({ isOpen, onClose, onSaved }) => {
  const [carrierCode, setCarrierCode] = useState<'GHN' | 'GHTK' | 'VTP'>('GHN');
  const [intraProvinceFee, setIntraProvinceFee] = useState('22000');
  const [interProvinceFee, setInterProvinceFee] = useState('32000');
  const [additionalKgFee, setAdditionalKgFee] = useState('5000');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch('/api/rate-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          carrier_code: carrierCode,
          tier_name: `Hợp đồng VIP ${carrierCode} 2026`,
          intra_province_base_fee: Number(intraProvinceFee),
          inter_province_base_fee: Number(interProvinceFee),
          additional_kg_fee: Number(additionalKgFee),
        }),
      });

      const data = await res.json();
      onSaved(data.data);
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
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900">Cài Đặt Biểu Giá Hợp Đồng (CN-23)</h3>
              <p className="text-[11px] text-slate-500">Cơ sở tính cước chuẩn phát hiện sai lệch phép dò D2 (BR-51)</p>
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
            <label className="font-bold text-slate-700 block mb-1">Hãng Áp Dụng:</label>
            <select
              value={carrierCode}
              onChange={(e: any) => setCarrierCode(e.target.value)}
              className="modern-input w-full text-xs font-semibold"
            >
              <option value="GHN">Giao Hàng Nhanh (GHN Express)</option>
              <option value="GHTK">Giao Hàng Tiết Kiệm (GHTK)</option>
              <option value="VTP">Viettel Post (VTP)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-bold text-slate-700 block mb-1">Cước Nội Tỉnh (&lt;1kg):</label>
              <input
                type="number"
                value={intraProvinceFee}
                onChange={(e) => setIntraProvinceFee(e.target.value)}
                className="modern-input w-full font-mono text-xs"
                required
              />
            </div>

            <div>
              <label className="font-bold text-slate-700 block mb-1">Cước Liên Tỉnh (&lt;1kg):</label>
              <input
                type="number"
                value={interProvinceFee}
                onChange={(e) => setInterProvinceFee(e.target.value)}
                className="modern-input w-full font-mono text-xs"
                required
              />
            </div>
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1">Phụ Phí Mỗi 0.5kg Tiếp Theo:</label>
            <input
              type="number"
              value={additionalKgFee}
              onChange={(e) => setAdditionalKgFee(e.target.value)}
              className="modern-input w-full font-mono text-xs"
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
              {loading ? 'Đang lưu...' : 'Lưu Biểu Giá Hợp Đồng'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
