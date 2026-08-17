'use client';

import React, { useState } from 'react';
import { Truck, X, Key, ShieldCheck } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConnected: (account: any) => void;
}

export const ConnectCarrierModal: React.FC<Props> = ({ isOpen, onClose, onConnected }) => {
  const [carrierCode, setCarrierCode] = useState<'GHN' | 'GHTK' | 'VTP'>('GHN');
  const [accountName, setAccountName] = useState('GHN Express - Kho Chính');
  const [token, setToken] = useState('tok_ghn_live_sec_9918239');
  const [clientId, setClientId] = useState('189201');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setErrorMsg('Vui lòng nhập API Token từ cổng tài khoản hãng.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/carrier-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'CONNECT_CARRIER',
          carrier_code: carrierCode,
          account_name: accountName,
          token,
          client_id: clientId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Không thể kết nối tài khoản');
      }

      onConnected(data.data);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full p-6 space-y-4 shadow-2xl text-xs animate-in zoom-in-95 duration-150">
        <div className="flex justify-between items-center pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900">Kết Nối Tài Khoản Hãng Vận Chuyển</h3>
              <p className="text-[11px] text-slate-500">Sử dụng API Token tài khoản riêng của Shop (BYO Account)</p>
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
            <label className="font-bold text-slate-700 block mb-1">Chọn Hãng Vận Chuyển:</label>
            <select
              value={carrierCode}
              onChange={(e: any) => {
                setCarrierCode(e.target.value);
                setAccountName(`${e.target.value} Express - Kho Chính`);
              }}
              className="modern-input w-full text-xs font-semibold"
            >
              <option value="GHN">Giao Hàng Nhanh (GHN) — Mức L2 Execute (API Trực Tiếp)</option>
              <option value="GHTK">Giao Hàng Tiết Kiệm (GHTK) — Mức L1 Assist (Hồ Sơ Hỗ Trợ)</option>
              <option value="VTP">Viettel Post (VTP) — Mức L2 Execute (API Trực Tiếp)</option>
            </select>
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1">Tên Gợi Nhớ Tài Khoản:</label>
            <input
              type="text"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              className="modern-input w-full text-xs"
              required
            />
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1">API Token / Secret Key Hãng:</label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Nhập chuỗi token..."
              className="modern-input w-full font-mono text-xs"
              required
            />
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1">Shop ID / Client ID (Tùy chọn):</label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Ví dụ: 189201"
              className="modern-input w-full font-mono text-xs"
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
              {loading ? 'Đang kết nối...' : 'Lưu & Kích Hoạt'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
