'use client';

import React, { useState } from 'react';
import { Settings, Shield, Sliders, CheckCircle2, RefreshCw, Database, Layers, ArrowRight } from 'lucide-react';
import { AutomationBadge } from './ui/OperationalComponents';

interface Props {
  carrierGhnTier?: 'L2' | 'L1';
  onToggleGhnTier?: (newTier: 'L2' | 'L1') => void;
  activeSection?: 'carrier_matrix' | 'unmapped_queue' | string;
}

export const AdminSystemTab: React.FC<Props> = ({
  carrierGhnTier = 'L2',
  onToggleGhnTier,
  activeSection = 'all',
}) => {
  const [internalTier, setInternalTier] = useState<'L2' | 'L1'>(carrierGhnTier);
  const [unmappedStatuses, setUnmappedStatuses] = useState([
    { raw_code: 'ghn_special_delay_flood', carrier: 'GHN', occurrences: 4, mapped_to: 'in_transit' },
  ]);
  const [toast, setToast] = useState<string | null>(null);

  const activeTier = onToggleGhnTier ? carrierGhnTier : internalTier;

  const handleToggleTier = () => {
    const nextTier = activeTier === 'L2' ? 'L1' : 'L2';
    if (onToggleGhnTier) {
      onToggleGhnTier(nextTier);
    } else {
      setInternalTier(nextTier);
    }
    setToast(
      `✓ Đã cập nhật ma trận năng lực GHN sang [${nextTier === 'L2' ? 'L2 EXECUTE (Gọi API trực tiếp)' : 'L1 ASSIST (Tạo hồ sơ hỗ trợ dán cổng)'}]. Phản ánh tức thì có phiên bản (BR-19, BR-44).`
    );
    setTimeout(() => setToast(null), 5000);
  };

  const showMatrix = activeSection === 'all' || activeSection === 'carrier_matrix';
  const showUnmapped = activeSection === 'all' || activeSection === 'unmapped_queue';

  return (
    <div className="w-full space-y-6">
      {toast && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs font-semibold flex items-center justify-between shadow-xs animate-in fade-in">
          <span>{toast}</span>
          <button type="button" onClick={() => setToast(null)} className="font-bold">✕</button>
        </div>
      )}

      {/* Header Bar */}
      <div className="modern-card p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-600" />
              <span>Bàn Điều Khiển Quản Trị Hệ Thống (Backoffice Ship Dễ)</span>
            </h2>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-bold">
              Nội Bộ Ship Dễ
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Quản trị viên cấu hình ma trận năng lực hãng (CN-05, BR-44) và xử lý hàng chờ trạng thái lạ chưa ánh xạ (CN-23, BR-18).
          </p>
        </div>
      </div>

      {/* Section 1: Carrier Capability Matrix */}
      {showMatrix && (
        <div className="modern-card p-6 space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-blue-600" />
                <span>1. Quản Lý Ma Trận Năng Lực Hãng Vận Chuyển (CN-05, BR-44)</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Quy định mức độ tự động hóa của từng hãng để hệ thống tự động chọn luồng gọi API hoặc tạo hồ sơ hỗ trợ.
              </p>
            </div>
            <button
              type="button"
              onClick={handleToggleTier}
              className="px-3.5 py-1.5 text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition cursor-pointer flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Chuyển Đổi Năng Lực GHN ({activeTier === 'L2' ? 'L2 → L1' : 'L1 → L2'})</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* GHN */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-slate-900">Giao Hàng Nhanh (GHN)</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded font-bold">R1 Core</span>
                </div>
                <AutomationBadge tier={activeTier} />
              </div>
              <p className="text-xs text-slate-600">
                {activeTier === 'L2'
                  ? '• L2 EXECUTE: Ship Dễ gọi API trực tiếp, nhận webhook và tự động bắn lệnh giao lại/khiếu nại tức thì.'
                  : '• L1 ASSIST (Đã hạ cấp): Ship Dễ chuẩn bị sẵn hồ sơ checklist để shop copy gửi tại cổng ticket của GHN.'}
              </p>
              <div className="text-[11px] text-slate-400 font-mono">
                Phiên bản rule: v3.2.1 · Áp dụng toàn hệ thống
              </div>
            </div>

            {/* GHTK */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-slate-900">Giao Hàng Tiết Kiệm (GHTK)</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded font-bold">R1 Core</span>
                </div>
                <AutomationBadge tier="L1" />
              </div>
              <p className="text-xs text-slate-600">
                • L1 ASSIST: Tự động tổng hợp dữ liệu bưu kiện, lịch sử liên hệ và sinh hồ sơ hỗ trợ chuẩn mẫu để shop dán vào cổng GHTK.
              </p>
              <div className="text-[11px] text-slate-400 font-mono">
                Phiên bản rule: v3.2.0 · Đang hoạt động ổn định
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Section 2: Unmapped Status Queue */}
      {showUnmapped && (
        <div className="modern-card p-6 space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Database className="w-4 h-4 text-amber-600" />
                <span>2. Hàng Chờ Trạng Thái Chưa Ánh Xạ (CN-23, BR-18)</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Bảo vệ BR-18: Khi nhận mã trạng thái lạ từ hãng, giữ nguyên trạng thái bưu kiện, không đoán bừa bãi và đưa vào hàng chờ kiểm tra.
              </p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-amber-50 text-amber-800 border border-amber-200">
              {unmappedStatuses.length} mã đang chờ xử lý
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100/70 text-slate-700 font-bold">
                  <th className="py-2.5 px-3">Mã Thô Của Hãng</th>
                  <th className="py-2.5 px-3">Hãng Phát Sinh</th>
                  <th className="py-2.5 px-3">Số Lần Xuất Hiện</th>
                  <th className="py-2.5 px-3">Đề Xuất Ánh Xạ</th>
                  <th className="py-2.5 px-3 text-right">Thao Tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {unmappedStatuses.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-800">{item.raw_code}</td>
                    <td className="py-2.5 px-3 font-semibold">{item.carrier}</td>
                    <td className="py-2.5 px-3 font-mono">{item.occurrences} lần</td>
                    <td className="py-2.5 px-3">
                      <span className="badge-warn font-mono text-[11px]">{item.mapped_to}</span>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setToast(`✓ Đã phát hành ánh xạ mới cho mã [${item.raw_code}] sang trạng thái chuẩn. Đang chạy lại sự kiện tồn đọng (FR-ADM-001).`);
                          setUnmappedStatuses([]);
                        }}
                        className="btn-primary text-xs py-1 px-2.5"
                      >
                        Phê Duyệt Ánh Xạ
                      </button>
                    </td>
                  </tr>
                ))}
                {unmappedStatuses.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-400 text-xs">
                      ✓ Hàng chờ trống. Toàn bộ mã trạng thái từ hãng đều đã được ánh xạ chuẩn xác.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
