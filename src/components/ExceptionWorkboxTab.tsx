'use client';

import React, { useState } from 'react';
import { UIExceptionItem } from './types';
import { MASTER_EXCEPTIONS } from '@/services/unifiedDataStore';
import {
  TrackingCode,
  Money,
  StatusBadge,
  AutomationBadge,
  ConfirmDialog,
} from './ui/OperationalComponents';
import {
  Phone,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Send,
  User,
  MapPin,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
} from 'lucide-react';

interface Props {
  exceptions?: UIExceptionItem[];
  onUpdateException?: (updated: UIExceptionItem) => void;
  carrierGhnTier?: 'L2' | 'L1';
}

export const ExceptionWorkboxTab: React.FC<Props> = ({
  exceptions = MASTER_EXCEPTIONS,
  onUpdateException,
  carrierGhnTier = 'L2',
}) => {
  const [caseList, setCaseList] = useState<UIExceptionItem[]>(exceptions);
  const [selectedCaseId, setSelectedCaseId] = useState<string>(caseList[0]?.id || '');
  const [filterType, setFilterType] = useState<'ALL' | 'MINE' | 'UNASSIGNED' | 'EXPIRING'>('ALL');
  const [callNote, setCallNote] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [scheduledDate, setScheduledDate] = useState('2026-08-18');
  const [reattemptNote, setReattemptNote] = useState('Khách hẹn giao lại ca chiều');
  const [toastFeedback, setToastFeedback] = useState<string | null>(null);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  const selectedCase = caseList.find((e) => e.id === selectedCaseId) || caseList[0];

  const myCasesCount = caseList.filter((e) => e.assigned_to?.includes('Hoa')).length;
  const unassignedCount = caseList.filter((e) => !e.assigned_to).length;
  const expiringCount = caseList.filter(
    (e) => (e.hours_remaining ?? 6) <= 4 && (e.hours_remaining ?? 6) > 0
  ).length;

  const filteredCases = caseList.filter((e) => {
    if (filterType === 'MINE') return e.assigned_to?.includes('Hoa');
    if (filterType === 'UNASSIGNED') return !e.assigned_to;
    if (filterType === 'EXPIRING')
      return (e.hours_remaining ?? 6) <= 4 && (e.hours_remaining ?? 6) > 0;
    return true;
  });

  const handleLogContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!callNote.trim()) {
      alert('Vui lòng nhập ghi chú cuộc gọi.');
      return;
    }
    setToastFeedback('✓ Đã ghi nhận nhật ký liên hệ khách hàng thành công.');
    setCallNote('');
    setTimeout(() => setToastFeedback(null), 3000);
  };

  const handleDispatchReattempt = async () => {
    if (!selectedCase) return;

    const updated = {
      ...selectedCase,
      status: 'REATTEMPT_REQUESTED' as any,
      version: (selectedCase.version || 1) + 1,
      attempts: (selectedCase.attempts || 1) + 1,
    };

    setCaseList((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    if (onUpdateException) onUpdateException(updated);

    setToastFeedback(
      selectedCase.carrier_code === 'GHN' && carrierGhnTier === 'L2'
        ? `✓ Đã tự động gửi yêu cầu giao lại qua API GHN cho mã ${selectedCase.tracking_code}.`
        : `✓ Đã tạo hồ sơ hỗ trợ cho đơn ${selectedCase.tracking_code}. Vui lòng dán lên cổng hỗ trợ của ${selectedCase.carrier_code}.`
    );
    setTimeout(() => setToastFeedback(null), 4000);
  };

  const currentTier = selectedCase?.carrier_code === 'GHN' ? carrierGhnTier : 'L1';

  return (
    <div className="w-full space-y-4">
      {toastFeedback && (
        <div className="p-3.5 bg-slate-900 text-white rounded-xl text-xs font-semibold flex items-center justify-between shadow-lg border border-slate-700 animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{toastFeedback}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastFeedback(null)}
            className="font-bold text-slate-400 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* 3-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column (3 cols): Filter Navigation */}
        <div className="lg:col-span-3 space-y-3">
          <div className="modern-card p-3 space-y-1">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider px-3 py-1.5 block">
              Phân Loại Sự Cố
            </span>

            {[
              { id: 'ALL', label: 'Tất cả sự cố', count: caseList.length, color: 'text-slate-900' },
              { id: 'MINE', label: 'Việc của tôi', count: myCasesCount, color: 'text-[#EA4B12]' },
              {
                id: 'UNASSIGNED',
                label: 'Chưa phân công',
                count: unassignedCount,
                color: 'text-slate-600',
              },
              {
                id: 'EXPIRING',
                label: 'Sắp hết hạn xử lý (<4h)',
                count: expiringCount,
                color: 'text-amber-700',
              },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilterType(f.id as any)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                  filterType === f.id
                    ? 'bg-[#FFF5F0] text-[#EA4B12] font-bold border border-[#FDDDD0]'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span>{f.label}</span>
                <span className={`font-mono text-xs font-bold ${f.color}`}>{f.count}</span>
              </button>
            ))}
          </div>

          <div className="modern-card p-4 space-y-2 text-xs">
            <span className="font-bold text-slate-900 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              Khóa Chống Can Thiệp Trùng
            </span>
            <p className="text-slate-500 leading-relaxed text-xs">
              Khi bạn mở hồ sơ, hệ thống khóa bảo vệ để ngăn nhân viên khác cùng thao tác đồng thời.
            </p>
          </div>
        </div>

        {/* Middle Column (4 cols): Urgency Exception List */}
        <div className="lg:col-span-4 modern-card flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50/70 flex justify-between items-center">
            <span className="font-bold text-xs text-slate-900">
              Danh Sách Sự Cố ({filteredCases.length})
            </span>
            <span className="text-xs text-slate-500">Xếp theo hạn xử lý</span>
          </div>

          <div className="overflow-y-auto flex-1 divide-y divide-slate-100 max-h-[calc(100vh-250px)] custom-scrollbar">
            {filteredCases.map((c) => {
              const isSelected = c.id === selectedCase?.id;
              const hrs = c.hours_remaining ?? 6;
              const isExpiring = hrs <= 4;

              return (
                <div
                  key={c.id}
                  onClick={() => setSelectedCaseId(c.id)}
                  className={`p-4 cursor-pointer transition ${
                    isSelected ? 'bg-[#FFF5F0] border-l-4 border-l-[#EA4B12]' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <TrackingCode code={c.tracking_code} />
                        <span className="text-xs font-bold text-slate-500">{c.carrier_code}</span>
                      </div>
                      <div className="font-bold text-slate-900 text-xs">
                        {c.carrier_reason || 'Khách không nghe máy lần 1'}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span>
                          COD:{' '}
                          <Money
                            amount={c.cod_amount}
                            state="pending"
                            className="inline text-xs font-bold"
                          />
                        </span>
                        <span>·</span>
                        <span>{c.recipient_name}</span>
                      </div>
                    </div>

                    <div className="text-right space-y-1.5 shrink-0">
                      <span className={isExpiring ? 'badge-risk text-xs' : 'badge-warn text-xs'}>
                        Còn {hrs}h
                      </span>
                      <div className="text-xs text-slate-500 font-medium">
                        {c.assigned_to ? c.assigned_to.split(' ')[0] : 'Chưa nhận'}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column (5 cols): Operational Action Drawer */}
        {selectedCase && (
          <div className="lg:col-span-5 modern-card p-5 space-y-5 overflow-y-auto max-h-[calc(100vh-250px)] custom-scrollbar text-xs">
            {/* Header */}
            <div className="border-b border-slate-100 pb-3 flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-base text-slate-900">
                    {selectedCase.tracking_code}
                  </span>
                  <AutomationBadge
                    tier={currentTier as any}
                    carrierCode={selectedCase.carrier_code}
                  />
                </div>
                <div className="text-slate-500 mt-1">
                  Đơn hàng: <strong>{selectedCase.order_code}</strong> · COD:{' '}
                  <Money amount={selectedCase.cod_amount} state="pending" className="inline" />
                </div>
              </div>
              <StatusBadge status={selectedCase.status} />
            </div>

            {/* Customer Details */}
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
              <div className="font-bold text-slate-900 text-xs">
                Khách hàng: {selectedCase.recipient_name}
              </div>
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
                  className="btn-secondary text-xs"
                >
                  Lưu SĐT
                </button>
              </div>
            </div>

            {/* Reattempt Action Form */}
            <div className="space-y-3 p-4 rounded-xl border border-[#FDDDD0] bg-[#FFF5F0]/50">
              <span className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                <Send className="w-4 h-4 text-[#EA4B12]" />
                Gửi Yêu Cầu Giao Lại (
                {currentTier === 'L2' ? 'Tự động gọi qua API' : 'Tạo hồ sơ dán cổng'}):
              </span>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">
                    Ngày hẹn giao:
                  </label>
                  <input
                    type="date"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    className="modern-input text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">
                    Ghi chú bưu tá:
                  </label>
                  <input
                    type="text"
                    value={reattemptNote}
                    onChange={(e) => setReattemptNote(e.target.value)}
                    className="modern-input text-xs"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleDispatchReattempt}
                className="btn-primary w-full justify-center text-xs py-2 mt-1"
              >
                {selectedCase.carrier_code === 'GHN' && carrierGhnTier === 'L2'
                  ? 'Gửi Yêu Cầu Giao Lại Qua API (GHN)'
                  : 'Tạo Hồ Sơ Hỗ Trợ Gửi Cổng Hãng (GHTK)'}
              </button>
            </div>

            {/* Contact Call Log Form */}
            <form onSubmit={handleLogContact} className="space-y-2">
              <label className="font-bold text-slate-900 block text-xs">
                Ghi Nhật Ký Cuộc Gọi CSKH:
              </label>
              <textarea
                value={callNote}
                onChange={(e) => setCallNote(e.target.value)}
                placeholder="Khách báo shipper chưa gọi, hẹn lại giao buổi chiều..."
                className="modern-input text-xs h-18 resize-none"
              />
              <button type="submit" className="btn-secondary text-xs w-full justify-center">
                Lưu Nhật Ký Cuộc Gọi
              </button>
            </form>

            {/* Expandable Technical Details (For Admins) */}
            <div className="pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
                className="flex items-center justify-between w-full text-xs font-bold text-slate-500 hover:text-slate-800 py-1"
              >
                <span>Chi Tiết Kỹ Thuật (Dành cho Quản Trị)</span>
                {showTechnicalDetails ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>

              {showTechnicalDetails && (
                <div className="p-3 bg-slate-100 rounded-lg font-mono text-[11px] text-slate-700 space-y-1 mt-2">
                  <div>case_id: {selectedCase.id}</div>
                  <div>carrier_code: {selectedCase.carrier_code}</div>
                  <div>version: {selectedCase.version || 1}</div>
                  <div>priority_score: {selectedCase.priority_score}</div>
                  <div>occurred_at: {selectedCase.occurred_at}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
