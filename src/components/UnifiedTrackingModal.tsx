'use client';

import React, { useState } from 'react';
import { getMockUnifiedTimeline } from './mock-data';
import { TrackingCode, Money, StatusBadge, AutomationBadge } from './ui/OperationalComponents';
import {
  X,
  Copy,
  Check,
  Eye,
  EyeOff,
  ShieldCheck,
  Download,
  ArrowRight,
  Phone,
  MapPin,
  Package,
} from 'lucide-react';

interface Props {
  trackingCode: string | null;
  onClose: () => void;
  onActionReattempt?: (code: string) => void;
  onActionClaim?: (code: string) => void;
}

export const UnifiedTrackingModal: React.FC<Props> = ({
  trackingCode,
  onClose,
  onActionReattempt,
  onActionClaim,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'timeline' | 'financial' | 'evidence'>(
    'timeline'
  );
  const [unmaskPii, setUnmaskPii] = useState(false);

  if (!trackingCode) return null;

  const isGhn = trackingCode.startsWith('GHN');
  const carrierName = isGhn ? 'GHN Express' : 'GHTK';
  const carrierTier = isGhn ? 'L2' : 'L1';
  const timelineEvents = getMockUnifiedTimeline(trackingCode);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div
        className="bg-white rounded-2xl max-w-3xl w-full flex flex-col max-h-[90vh] overflow-hidden shadow-2xl border border-slate-200 text-xs animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="p-5 border-b border-slate-100 bg-slate-50/70 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-lg text-slate-900">{trackingCode}</span>
                <AutomationBadge tier={carrierTier as any} carrierCode={isGhn ? 'GHN' : 'GHTK'} />
              </div>
              <div className="text-slate-500 mt-0.5">
                Mã đơn: <strong>ORD_ANAN_101</strong> · Khách: <strong>Nguyễn Văn Khách</strong>{' '}
                (SĐT: {unmaskPii ? '0901234567' : '090*** 567'})
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setUnmaskPii(!unmaskPii)}
              className="btn-secondary text-xs py-1"
              title="Ghi nhật ký mở xem PII (BR-42)"
            >
              {unmaskPii ? (
                <EyeOff className="w-3.5 h-3.5" />
              ) : (
                <Eye className="w-3.5 h-3.5 text-blue-600" />
              )}
              <span>{unmaskPii ? 'Ẩn PII' : 'Mở xem PII'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-slate-500 flex items-center justify-center font-bold text-xs cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Sub-tab Navigation */}
        <div className="flex border-b border-slate-200 bg-white px-5 text-xs font-semibold gap-2 pt-1">
          {[
            { id: 'timeline', label: 'Hành Trình Hợp Nhất 3 Nguồn (CN-06)' },
            { id: 'financial', label: 'Chi Tiết Cước & Sai Lệch Đối Soát (CN-15)' },
            { id: 'evidence', label: 'Hồ Sơ Chứng Cứ Khiếu Nại (CN-16)' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveSubTab(t.id as any)}
              className={`py-2.5 px-3 border-b-2 transition cursor-pointer ${
                activeSubTab === t.id
                  ? 'border-blue-600 text-blue-600 font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar space-y-4">
          {activeSubTab === 'timeline' && (
            <div className="space-y-4">
              <span className="font-bold text-slate-900 block text-xs">
                Dòng Sự Kiện Hợp Nhất (Người ‖ Hãng ‖ Hệ Thống):
              </span>

              <div className="space-y-4 pl-4 border-l-2 border-slate-200 ml-2 text-xs">
                {timelineEvents.map((ev, idx) => (
                  <div key={idx} className="relative">
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-600 absolute -left-[21px] top-1.5 ring-4 ring-white" />
                    <div className="flex justify-between items-baseline">
                      <span className="font-bold text-slate-900 text-xs">{ev.title}</span>
                      <span className="font-mono text-[11px] text-slate-400">{ev.occurred_at}</span>
                    </div>
                    <p className="text-slate-600 mt-0.5">{ev.description}</p>
                    <div className="text-[10px] text-slate-400 mt-1">
                      Nguồn: <span className="font-semibold text-slate-600">{ev.source_label}</span>{' '}
                      {ev.actor && `· Thực hiện: ${ev.actor}`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSubTab === 'financial' && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200/80">
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold uppercase">
                    1. Số hệ thống (Biểu giá)
                  </span>
                  <div className="font-mono text-base font-bold text-slate-900 mt-0.5">
                    <Money amount={22000} state="confirmed" />
                  </div>
                  <div className="text-slate-500 text-[11px] mt-0.5">Khai báo: 250g · Nội tỉnh</div>
                </div>

                <div className="border-l border-slate-200 pl-3">
                  <span className="text-[10px] text-slate-500 font-semibold uppercase">
                    2. Số hãng sao kê
                  </span>
                  <div className="font-mono text-base font-bold text-rose-600 mt-0.5">
                    <Money amount={29000} state="confirmed" />
                  </div>
                  <div className="text-slate-500 text-[11px] mt-0.5">Hãng cân: 800g · Bậc 1kg</div>
                </div>

                <div className="border-l border-slate-200 pl-3">
                  <span className="text-[10px] text-slate-500 font-semibold uppercase">
                    3. Chênh lệch phát hiện
                  </span>
                  <div className="font-mono text-base font-black text-rose-600 mt-0.5">
                    <Money amount={7000} state="confirmed" showSign />
                  </div>
                  <div className="text-rose-700 font-semibold text-[11px] mt-0.5">
                    Phép dò D2_FREIGHT
                  </div>
                </div>
              </div>

              <div className="p-3 bg-blue-50/50 rounded-xl border border-blue-100 text-xs text-blue-900">
                * Áp dụng quy tắc Maker-Checker (BR-12): CSKH can thiệp đơn này không được tự duyệt
                chấp thuận chênh lệch 7.000 đ.
              </div>
            </div>
          )}

          {activeSubTab === 'evidence' && (
            <div className="space-y-3">
              <span className="font-bold text-slate-900 block text-xs">
                Danh Sách Chứng Cứ Tự Động Thu Thập (CN-16):
              </span>

              <div className="space-y-2">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 flex justify-between items-center text-xs">
                  <span className="font-medium text-slate-800">
                    1. Lịch sử quét webhook hãng (12 sự kiện)
                  </span>
                  <span className="badge-ok text-[10px]">Đã ký SHA-256</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 flex justify-between items-center text-xs">
                  <span className="font-medium text-slate-800">
                    2. Nhật ký cuộc gọi CSKH cứu đơn (Ghi âm MP3)
                  </span>
                  <span className="badge-ok text-[10px]">Đã đính kèm</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 flex justify-between items-center text-xs">
                  <span className="font-medium text-slate-800">
                    3. Dòng sao kê cước trừ sai (Kỳ đối soát 01/08 - 15/08)
                  </span>
                  <span className="badge-ok text-[10px]">Trích xuất tự động</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-between items-center">
          <button type="button" onClick={onClose} className="btn-secondary text-xs">
            Đóng
          </button>

          <div className="flex gap-2">
            {onActionReattempt && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onActionReattempt(trackingCode);
                }}
                className="btn-primary text-xs"
              >
                Gửi Lệnh Giao Lại (CN-10) →
              </button>
            )}
            {onActionClaim && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onActionClaim(trackingCode);
                }}
                className="btn-secondary text-xs text-rose-700 hover:bg-rose-50 border-rose-200"
              >
                Khởi Tạo Khiếu Nại (CN-16) →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
