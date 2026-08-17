'use client';

import React from 'react';
import { TrackingCode, Money, StatusBadge, AutomationBadge } from './ui/OperationalComponents';
import {
  MASTER_SHIPMENTS,
  MASTER_EXCEPTIONS,
  MASTER_DISCREPANCIES,
  MASTER_CLAIMS,
  getUnifiedMetrics,
} from '@/services/unifiedDataStore';
import {
  Package,
  AlertTriangle,
  Clock,
  DollarSign,
  TrendingUp,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Sliders,
  RotateCcw,
  Truck,
} from 'lucide-react';

interface Props {
  role: string;
  onNavigate: (tab: string) => void;
}

export const ControlTowerTab: React.FC<Props> = ({ role, onNavigate }) => {
  const metrics = getUnifiedMetrics();

  const urgentExceptions = MASTER_EXCEPTIONS.filter((e) => e.status === 'OPEN').slice(0, 3);
  const urgentDiscrepancies = MASTER_DISCREPANCIES.filter((d) => d.status === 'OPEN').slice(0, 3);

  return (
    <div className="w-full space-y-6">
      {/* 4 Unified Operational KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Active Shipments */}
        <div
          onClick={() => onNavigate('shipments')}
          className="modern-card p-5 cursor-pointer flex flex-col justify-between group hover:border-[#EA4B12] transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Tổng Bưu Kiện Đang Chạy</span>
            <div className="w-9 h-9 rounded-xl bg-[#FFF5F0] text-[#EA4B12] flex items-center justify-center">
              <Package className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="my-2">
            <div className="text-3xl font-black font-mono text-slate-900">{metrics.activeShipments}</div>
            <div className="text-xs text-slate-500 mt-0.5">Trên tổng số {metrics.totalShipments} bưu kiện trong hệ thống</div>
          </div>
          <div className="flex items-center gap-1 text-xs font-semibold text-[#EA4B12] group-hover:underline pt-2 border-t border-slate-100">
            <span>Mở danh sách vận đơn</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Metric 2: Open Exceptions Needing Rescue */}
        <div
          onClick={() => onNavigate('exceptions')}
          className="modern-card p-5 cursor-pointer flex flex-col justify-between group hover:border-amber-400 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Sự Cố Cần Cứu Đơn Gấp</span>
            <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center">
              <AlertTriangle className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="my-2">
            <div className="text-3xl font-black font-mono text-amber-700">{metrics.openExceptionsCount}</div>
            <div className="text-xs text-slate-500 mt-0.5">Giao thất bại, trễ lấy hàng, đọng trung chuyển</div>
          </div>
          <div className="flex items-center gap-1 text-xs font-semibold text-amber-700 group-hover:underline pt-2 border-t border-slate-100">
            <span>Vào hộp việc CSKH</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Metric 3: Financial Discrepancies */}
        <div
          onClick={() => onNavigate('reconciliation')}
          className="modern-card p-5 cursor-pointer flex flex-col justify-between group hover:border-rose-400 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Khoản Lệch Cước & COD</span>
            <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center">
              <DollarSign className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="my-2">
            <div className="text-3xl font-black font-mono text-rose-700">
              <Money amount={metrics.totalDiscrepancyAmount} state="confirmed" />
            </div>
            <div className="text-xs text-slate-500 mt-0.5">{metrics.openDiscrepanciesCount} khoản lệch đang chờ duyệt</div>
          </div>
          <div className="flex items-center gap-1 text-xs font-semibold text-rose-700 group-hover:underline pt-2 border-t border-slate-100">
            <span>Duyệt đối soát chênh lệch</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Metric 4: Rescued & Recovered Value */}
        <div
          onClick={() => onNavigate('three_ledgers')}
          className="modern-card p-5 cursor-pointer flex flex-col justify-between group hover:border-emerald-400 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Bồi Thường Đã Thu Hồi</span>
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <TrendingUp className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="my-2">
            <div className="text-3xl font-black font-mono text-emerald-700">
              <Money amount={1500000} state="confirmed" />
            </div>
            <div className="text-xs text-slate-500 mt-0.5">Tiền bồi thường thực nhận đã về tài khoản</div>
          </div>
          <div className="flex items-center gap-1 text-xs font-semibold text-emerald-700 group-hover:underline pt-2 border-t border-slate-100">
            <span>Xem Báo Cáo Ba Sổ</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>

      {/* Priority Work Queue (Trả Lời 3 Câu Hỏi Vận Hành) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Panel 1: Urgent Exceptions Requiring Action */}
        <div className="modern-card p-6 space-y-4">
          <div className="flex justify-between items-center pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <AlertTriangle className="w-4.5 h-4.5 text-amber-600" />
                <span>Hàng Đợi Cứu Đơn Cần Can Thiệp Hôm Nay</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">Các đơn giao không thành công sắp chạm hạn chót hãng chuyển hoàn.</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('exceptions')}
              className="btn-secondary text-xs"
            >
              Xem Tất Cả ({metrics.openExceptionsCount})
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {urgentExceptions.map((exc) => (
              <div key={exc.id} className="py-3 flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <TrackingCode code={exc.tracking_code} onClick={() => onNavigate('exceptions')} />
                    <span className="font-bold text-xs text-slate-700">{exc.carrier_code}</span>
                    <span className="badge-warn text-xs">Còn {exc.hours_remaining}h</span>
                  </div>
                  <div className="text-xs text-slate-600 font-medium">
                    {exc.carrier_reason || 'Khách không nghe máy (Lần 1)'}
                  </div>
                  <div className="text-xs text-slate-400">
                    Người nhận: <strong>{exc.recipient_name}</strong> · COD: <Money amount={exc.cod_amount} state="pending" className="inline text-xs" />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onNavigate('exceptions')}
                  className="btn-primary text-xs shrink-0 py-1.5 px-3"
                >
                  Xử Lý Ngay
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Panel 2: Urgent Discrepancies Requiring Maker-Checker Approval */}
        <div className="modern-card p-6 space-y-4">
          <div className="flex justify-between items-center pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <DollarSign className="w-4.5 h-4.5 text-rose-600" />
                <span>Khoản Lệch Tài Chính Chờ Kế Toán Duyệt</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">Phát hiện qua 6 phép dò đối soát tự động so với biểu giá hợp đồng.</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('reconciliation')}
              className="btn-secondary text-xs"
            >
              Đối Soát Kỳ Này
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {urgentDiscrepancies.map((disc) => (
              <div key={disc.id} className="py-3 flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <TrackingCode code={disc.tracking_code} onClick={() => onNavigate('reconciliation')} />
                    <StatusBadge status={disc.type} />
                  </div>
                  <div className="text-xs text-slate-600">
                    {disc.reason}
                  </div>
                  <div className="text-xs text-rose-700 font-bold font-mono">
                    Chênh lệch: <Money amount={disc.discrepancy_amount} state="confirmed" className="inline" />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onNavigate('reconciliation')}
                  className="btn-secondary text-xs shrink-0 py-1.5 px-3 font-semibold"
                >
                  Kiểm Tra
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
