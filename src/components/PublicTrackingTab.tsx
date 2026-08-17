'use client';

import React, { useState } from 'react';
import { Search, ShieldCheck, MapPin, CheckCircle2, Clock, EyeOff, Truck } from 'lucide-react';
import { TrackingCode, Money, StatusBadge } from './ui/OperationalComponents';

export const PublicTrackingTab: React.FC = () => {
  const [trackingCode, setTrackingCode] = useState('GHN88291042');
  const [phoneDigits, setPhoneDigits] = useState('5678');
  const [searched, setSearched] = useState(true);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearched(true);
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Header Bar */}
      <div className="modern-card p-6 space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Search className="w-5 h-5 text-blue-600" />
              Cổng Tra Cứu Hành Trình Đơn Hàng Công Khai (CN-20)
            </h2>
            <span className="badge-info text-xs">Dành Cho Người Mua</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Tra cứu trực tiếp không cần đăng nhập. Tự động che số điện thoại PII (BR-42), ẩn toàn bộ cước phí và ghi chú nội bộ của shop.
          </p>
        </div>

        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3 pt-2 border-t border-slate-100">
          <div className="flex-1">
            <label className="text-xs font-semibold text-slate-700 block mb-1">Mã Vận Đơn (GHN / GHTK):</label>
            <input
              type="text"
              value={trackingCode}
              onChange={(e) => setTrackingCode(e.target.value)}
              placeholder="Nhập mã vận đơn..."
              className="modern-input w-full font-mono uppercase font-bold text-xs"
            />
          </div>

          <div className="w-full sm:w-56">
            <label className="text-xs font-semibold text-slate-700 block mb-1">4 Số Cuối SĐT Người Nhận:</label>
            <input
              type="text"
              value={phoneDigits}
              onChange={(e) => setPhoneDigits(e.target.value)}
              placeholder="Ví dụ: 5678"
              className="modern-input w-full font-mono text-xs"
              maxLength={4}
            />
          </div>

          <div className="flex items-end">
            <button type="submit" className="btn-primary py-2.5 px-6">
              Tra Cứu
            </button>
          </div>
        </form>
      </div>

      {searched && (
        <div className="modern-card p-6 space-y-6 animate-in fade-in">
          {/* Tracking Summary Block */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200/80">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="font-mono font-bold text-lg text-slate-900">{trackingCode.toUpperCase()}</span>
                <span className="badge-ok text-xs">GHN Express</span>
              </div>
              <div className="text-xs text-slate-600 mt-1">
                Người nhận: <strong>Nguyễn Văn Khách</strong> · SĐT: <strong className="font-mono">090*** {phoneDigits || '5678'}</strong> (Đã che PII)
              </div>
            </div>

            <div className="text-right">
              <span className="badge-warn text-xs font-bold">Đang giao lại ca chiều</span>
              <div className="text-[11px] text-slate-400 mt-1">Dự kiến giao: 17/08/2026</div>
            </div>
          </div>

          {/* Masking Notice Banner */}
          <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-100 flex items-center gap-2.5 text-xs text-blue-900">
            <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
            <span>Quy tắc bảo mật BR-42: Cổng công khai chỉ hiển thị hành trình và số tiền thu hộ COD. Cước phí và nhật ký nội bộ của shop được ẩn an toàn.</span>
          </div>

          {/* Timeline Events */}
          <div className="space-y-3 pt-2">
            <h4 className="font-bold text-sm text-slate-900">Chi Tiết Hành Trình Vận Chuyển:</h4>

            <div className="space-y-4 pl-4 border-l-2 border-slate-200 ml-2 text-xs">
              <div className="relative">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500 absolute -left-[21px] top-1 ring-4 ring-white" />
                <div className="font-bold text-slate-900">Khách hẹn giao lại ca chiều (14:00 – 17:00)</div>
                <div className="text-[11px] text-slate-500 font-mono mt-0.5">17/08/2026 · 09:30 · Shipper GHN (Nguyễn Văn Giao)</div>
              </div>

              <div className="relative">
                <div className="w-2.5 h-2.5 rounded-full bg-rose-500 absolute -left-[21px] top-1 ring-4 ring-white" />
                <div className="font-bold text-slate-900">Giao hàng không thành công lần 1 (Không nghe máy)</div>
                <div className="text-[11px] text-slate-500 font-mono mt-0.5">17/08/2026 · 08:15 · Bưu cục Tân Bình, TP.HCM</div>
              </div>

              <div className="relative">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 absolute -left-[21px] top-1 ring-4 ring-white" />
                <div className="font-bold text-slate-900">Đã rời kho phân loại TP. Hồ Chí Minh</div>
                <div className="text-[11px] text-slate-500 font-mono mt-0.5">16/08/2026 · 22:40 · Hub HCM 01</div>
              </div>

              <div className="relative">
                <div className="w-2.5 h-2.5 rounded-full bg-slate-400 absolute -left-[21px] top-1 ring-4 ring-white" />
                <div className="font-bold text-slate-900">Shop An An Boutique đã bàn giao bưu kiện cho shipper</div>
                <div className="text-[11px] text-slate-500 font-mono mt-0.5">16/08/2026 · 14:10 · Kho Tân Bình</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
