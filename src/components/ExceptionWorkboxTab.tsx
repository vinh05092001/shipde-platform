'use client';

import React, { useState } from 'react';
import { UIExceptionItem } from './types';
import { getMockUnifiedTimeline } from './mock-data';
import { TrackingCode, Money, StatusBadge, AutomationBadge, ConfirmDialog } from './ui/OperationalComponents';
import {
  Phone,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Send,
  User,
  MapPin,
  Sparkles,
  ShieldCheck,
  Edit2,
  Check,
  RotateCcw,
  ArrowRight,
  Filter,
} from 'lucide-react';

interface Props {
  exceptions: UIExceptionItem[];
  onUpdateException: (updated: UIExceptionItem) => void;
  carrierGhnTier: 'L2' | 'L1';
}

export const ExceptionWorkboxTab: React.FC<Props> = ({
  exceptions,
  onUpdateException,
  carrierGhnTier,
}) => {
  const [selectedCaseId, setSelectedCaseId] = useState<string>(exceptions[0]?.id || '');
  const [filterType, setFilterType] = useState<'ALL' | 'MINE' | 'UNASSIGNED' | 'EXPIRING' | 'OVERDUE'>('ALL');
  const [callNote, setCallNote] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [scheduledDate, setScheduledDate] = useState('2026-08-18');
  const [reattemptNote, setReattemptNote] = useState('Khách hẹn giao lại ca chiều');
  const [toastFeedback, setToastFeedback] = useState<string | null>(null);

  const selectedCase = exceptions.find((e) => e.id === selectedCaseId) || exceptions[0];

  // Filters logic
  const myCasesCount = exceptions.filter((e) => e.assigned_to?.includes('Hoa')).length;
  const unassignedCount = exceptions.filter((e) => !e.assigned_to).length;
  const expiringCount = exceptions.filter((e) => (e.hours_remaining ?? 6) <= 4 && (e.hours_remaining ?? 6) > 0).length;
  const overdueCount = exceptions.filter((e) => (e.hours_remaining ?? 6) <= 0).length;

  const filteredCases = exceptions.filter((e) => {
    if (filterType === 'MINE') return e.assigned_to?.includes('Hoa');
    if (filterType === 'UNASSIGNED') return !e.assigned_to;
    if (filterType === 'EXPIRING') return (e.hours_remaining ?? 6) <= 4 && (e.hours_remaining ?? 6) > 0;
    if (filterType === 'OVERDUE') return (e.hours_remaining ?? 6) <= 0;
    return true;
  });

  const handleLogContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!callNote.trim()) {
      alert('Vui lòng nhập ghi chú cuộc gọi.');
      return;
    }

    setToastFeedback('✓ Đã ghi nhận nhật ký liên hệ khách hàng thành công (CN-09).');
    setCallNote('');
    setTimeout(() => setToastFeedback(null), 3000);
  };

  const handleDispatchReattempt = async () => {
    if (!selectedCase) return;

    try {
      const res = await fetch('/api/exceptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'DISPATCH_REATTEMPT',
          exception_id: selectedCase.id,
          tracking_code: selectedCase.tracking_code,
          carrier_code: selectedCase.carrier_code,
          scheduled_date: scheduledDate,
          note: reattemptNote,
          new_phone: newPhone || undefined,
          user_id: 'usr_02',
          user_name: 'Trần Thị Hoa (CSKH)',
          current_version: selectedCase.version || 1,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Lỗi gửi yêu cầu giao lại');
      }

      const updated = {
        ...selectedCase,
        status: 'REATTEMPT_REQUESTED' as any,
        version: (selectedCase.version || 1) + 1,
        reattempt_count: (selectedCase.reattempt_count || 1) + 1,
      };
      onUpdateException(updated);
      setToastFeedback(
        selectedCase.carrier_code === 'GHN' && carrierGhnTier === 'L2'
          ? `✓ [L2 EXECUTE] Đã gọi API GHN gửi lệnh giao lại thành công cho mã ${selectedCase.tracking_code}.`
          : `✓ [L1 ASSIST] Đã tạo hồ sơ hỗ trợ cho đơn ${selectedCase.tracking_code}. Vui lòng dán thông tin lên cổng ${selectedCase.carrier_code}.`
      );
      setTimeout(() => setToastFeedback(null), 4000);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const currentTier = selectedCase?.carrier_code === 'GHN' ? carrierGhnTier : 'L1';
  const timelineEvents = selectedCase ? getMockUnifiedTimeline(selectedCase.tracking_code) : [];

  return (
    <div className="w-full space-y-4">
      {toastFeedback && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs font-semibold flex items-center justify-between shadow-sm animate-in fade-in">
          <span>{toastFeedback}</span>
          <button type="button" onClick={() => setToastFeedback(null)} className="font-bold">✕</button>
        </div>
      )}

      {/* 3-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column (3 cols): Filter Navigation */}
        <div className="lg:col-span-3 space-y-3">
          <div className="modern-card p-3 space-y-1">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-3 py-1 block">
              Bộ Lọc Hồ Sơ
            </span>

            {[
              { id: 'ALL', label: 'Tất cả sự cố', count: exceptions.length, color: 'text-slate-900' },
              { id: 'MINE', label: 'Việc của tôi', count: myCasesCount, color: 'text-blue-600' },
              { id: 'UNASSIGNED', label: 'Chưa phân công', count: unassignedCount, color: 'text-slate-600' },
              { id: 'EXPIRING', label: 'Sắp hết hạn SLA (<4h)', count: expiringCount, color: 'text-amber-700' },
              { id: 'OVERDUE', label: 'Đã quá hạn SLA', count: overdueCount, color: 'text-rose-600' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilterType(f.id as any)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition ${
                  filterType === f.id
                    ? 'bg-blue-50 text-blue-700 font-bold'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span>{f.label}</span>
                <span className={`font-mono text-xs ${f.color}`}>{f.count}</span>
              </button>
            ))}
          </div>

          <div className="modern-card p-4 space-y-2 text-xs">
            <span className="font-bold text-slate-900 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              Khóa Chống Trùng (BR-33)
            </span>
            <p className="text-slate-500 leading-relaxed text-[11px]">
              Khi bạn đang mở hồ sơ này, hệ thống tự động khóa lạc quan để ngăn CSKH khác cùng can thiệp gửi lệnh đồng thời.
            </p>
          </div>
        </div>

        {/* Middle Column (4 cols): Urgency Exception List */}
        <div className="lg:col-span-4 modern-card flex flex-col overflow-hidden">
          <div className="p-3.5 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
            <span className="font-bold text-xs text-slate-900">
              Danh Sách Ngoại Lệ ({filteredCases.length})
            </span>
            <span className="text-[11px] text-slate-500">Xếp theo hạn SLA</span>
          </div>

          <div className="overflow-y-auto flex-1 divide-y divide-slate-100 max-h-[calc(100vh-250px)] custom-scrollbar">
            {filteredCases.map((c) => {
              const isSelected = c.id === selectedCase?.id;
              const hrs = c.hours_remaining ?? 6;
              const isOverdue = hrs <= 0;
              const isExpiring = hrs <= 4 && hrs > 0;

              return (
                <div
                  key={c.id}
                  onClick={() => setSelectedCaseId(c.id)}
                  className={`p-3.5 cursor-pointer transition ${
                    isSelected ? 'bg-blue-50/70 border-l-4 border-l-blue-600' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <TrackingCode code={c.tracking_code} />
                        <span className="text-[11px] font-bold text-slate-500">{c.carrier_code}</span>
                      </div>
                      <div className="font-bold text-slate-900 text-xs">
                        {c.reason || c.carrier_reason || 'Khách không nghe máy lần 1'}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500">
                        <span>COD: <Money amount={c.cod_amount} state="pending" className="inline text-xs" /></span>
                        <span>·</span>
                        <span>{c.customer_name || c.recipient_name || 'Khách hàng'}</span>
                      </div>
                    </div>

                    <div className="text-right space-y-1.5 shrink-0">
                      <span className={isOverdue ? 'badge-risk text-[10px]' : isExpiring ? 'badge-warn text-[10px]' : 'badge-info text-[10px]'}>
                        {isOverdue ? 'Quá hạn' : `Còn ${hrs}h`}
                      </span>
                      <div className="text-[10px] text-slate-500 font-mono">
                        {c.assigned_to ? c.assigned_to.split(' ')[0] : 'Chưa nhận'}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column (5 cols): Inline Action Drawer */}
        {selectedCase && (
          <div className="lg:col-span-5 modern-card p-5 space-y-5 overflow-y-auto max-h-[calc(100vh-250px)] custom-scrollbar text-xs">
            {/* Case Header */}
            <div className="border-b border-slate-100 pb-3 flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-base text-slate-900">{selectedCase.tracking_code}</span>
                  <AutomationBadge tier={currentTier as any} carrierCode={selectedCase.carrier_code} />
                </div>
                <div className="text-slate-500 mt-1">
                  Mã đơn: <strong>{selectedCase.order_code}</strong> · COD: <Money amount={selectedCase.cod_amount} state="pending" className="inline" />
                </div>
              </div>
              <StatusBadge status={selectedCase.status} />
            </div>

            {/* Inline Customer Phone Editor */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2">
              <span className="font-bold text-slate-900 block">
                Khách hàng: {selectedCase.customer_name || selectedCase.recipient_name}
              </span>
              <div className="flex gap-2">
                <input
                  type="tel"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="modern-input flex-1 font-mono text-xs"
                  placeholder="Nhập SĐT mới nếu khách đổi..."
                />
                <button
                  type="button"
                  onClick={() => alert(`✓ Đã lưu số điện thoại mới: ${newPhone}`)}
                  className="btn-secondary text-xs py-1"
                >
                  Lưu SĐT
                </button>
              </div>
            </div>

            {/* Reattempt Action Dispatch */}
            <div className="space-y-3 p-4 rounded-xl border border-blue-100 bg-blue-50/30">
              <span className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                <Send className="w-3.5 h-3.5 text-blue-600" />
                Gửi Yêu Cầu Giao Lại ({currentTier === 'L2' ? 'Tự động gửi qua API GHN' : 'Tạo hồ sơ hỗ trợ dán cổng GHTK'}):
              </span>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">Ngày hẹn giao:</label>
                  <input
                    type="date"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    className="modern-input w-full text-xs"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">Ghi chú cho shipper:</label>
                  <input
                    type="text"
                    value={reattemptNote}
                    onChange={(e) => setReattemptNote(e.target.value)}
                    className="modern-input w-full text-xs"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleDispatchReattempt}
                className="btn-primary w-full justify-center text-xs py-2 mt-1"
              >
                {selectedCase.carrier_code === 'GHN' && carrierGhnTier === 'L2'
                  ? 'Gửi Yêu Cầu Giao Lại Qua API (GHN L2)'
                  : 'Tạo Hồ Sơ Hỗ Trợ Gửi Cổng Hãng (GHTK L1)'}
              </button>
            </div>

            {/* CSKH Contact Log Form */}
            <form onSubmit={handleLogContact} className="space-y-2">
              <label className="font-bold text-slate-900 block">
                Ghi Nhật Ký Cuộc Gọi CSKH (CN-09):
              </label>
              <textarea
                value={callNote}
                onChange={(e) => setCallNote(e.target.value)}
                placeholder="Khách báo shipper chưa gọi, hẹn lại giao buổi chiều..."
                className="modern-input w-full text-xs h-16 resize-none"
              />
              <button type="submit" className="btn-secondary text-xs w-full justify-center">
                Lưu Nhật Ký Cuộc Gọi
              </button>
            </form>

            {/* Unified 3-Source Timeline */}
            <div className="space-y-3 pt-3 border-t border-slate-100">
              <span className="font-bold text-slate-900 block">Hành Trình Hợp Nhất 3 Nguồn:</span>
              <div className="space-y-3 pl-3 border-l-2 border-slate-200 ml-2 text-xs">
                {timelineEvents.map((ev, idx) => (
                  <div key={idx} className="relative">
                    <div className="w-2 h-2 rounded-full bg-blue-600 absolute -left-[17px] top-1.5 ring-4 ring-white" />
                    <div className="font-semibold text-slate-900">{ev.title}</div>
                    <div className="text-slate-500 mt-0.5">{ev.description}</div>
                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">{ev.occurred_at} · {ev.source_label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
