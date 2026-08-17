'use client';

import React from 'react';
import { ActiveRole, UIExceptionItem, UIDiscrepancyItem, UIClaimItem } from './types';
import { TrackingCode, Money, StatusBadge, AutomationBadge } from './ui/OperationalComponents';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import {
  Package,
  AlertTriangle,
  Clock,
  DollarSign,
  TrendingUp,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';

interface Props {
  role: string;
  exceptions: UIExceptionItem[];
  discrepancies: UIDiscrepancyItem[];
  claims: UIClaimItem[];
  onNavigate: (tab: string) => void;
}

const WEEKLY_TREND = [
  { day: 'T2', failCount: 14, rescuedCount: 11 },
  { day: 'T3', failCount: 18, rescuedCount: 15 },
  { day: 'T4', failCount: 12, rescuedCount: 10 },
  { day: 'T5', failCount: 22, rescuedCount: 19 },
  { day: 'T6', failCount: 16, rescuedCount: 14 },
  { day: 'T7', failCount: 9, rescuedCount: 8 },
  { day: 'CN', failCount: 7, rescuedCount: 6 },
];

export const ControlTowerTab: React.FC<Props> = ({
  role,
  exceptions,
  discrepancies,
  claims,
  onNavigate,
}) => {
  const openExceptions = exceptions.filter((e) => e.status === 'OPEN' || e.status === 'ASSIGNED');
  const openDiscrepancies = discrepancies.filter((d) => String(d.status).toUpperCase() === 'OPEN');
  const urgentClaims = claims.filter((c) => c.status !== 'CLOSED');

  return (
    <div className="w-full space-y-6">
      {/* 4 Modern Operational KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          onClick={() => onNavigate('shipments')}
          className="modern-card p-5 cursor-pointer flex flex-col justify-between group hover:border-blue-300"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Đơn Đang Hoạt Động</span>
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:scale-105 transition-transform">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div className="my-2">
            <div className="text-3xl font-black font-mono text-slate-900">1.420 <span className="text-sm font-normal text-slate-500">đơn</span></div>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
            <span>GHN: 980 · GHTK: 440</span>
            <ArrowRight className="w-3.5 h-3.5 text-blue-600 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </div>

        <div
          onClick={() => onNavigate('exceptions')}
          className="modern-card p-5 cursor-pointer flex flex-col justify-between group hover:border-rose-300 bg-rose-50/10"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-rose-600 uppercase tracking-wider">Cần Can Thiệp Gấp</span>
            <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center group-hover:scale-105 transition-transform">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="my-2">
            <div className="text-3xl font-black font-mono text-rose-600">{openExceptions.length} <span className="text-sm font-normal text-slate-500">hồ sơ</span></div>
          </div>
          <div className="flex items-center justify-between text-xs text-rose-700 pt-2 border-t border-rose-100">
            <span>SLA 12h: còn 2h45m</span>
            <ArrowRight className="w-3.5 h-3.5 text-rose-600 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </div>

        <div
          onClick={() => onNavigate('reconciliation')}
          className="modern-card p-5 cursor-pointer flex flex-col justify-between group hover:border-amber-300"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-700 uppercase tracking-wider">Lệch Cước Chưa Duyệt</span>
            <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center group-hover:scale-105 transition-transform">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="my-2">
            <div className="text-3xl font-black font-mono text-slate-900">
              <Money amount={openDiscrepancies.reduce((sum, d) => sum + (d.discrepancy_amount || d.amount || 0), 0)} state="confirmed" />
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
            <span>{openDiscrepancies.length} khoản phát hiện (D1–D7)</span>
            <ArrowRight className="w-3.5 h-3.5 text-blue-600 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </div>

        <div
          onClick={() => onNavigate('claims')}
          className="modern-card p-5 cursor-pointer flex flex-col justify-between group hover:border-purple-300"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-purple-700 uppercase tracking-wider">Khiếu Nại Còn &lt; 48H</span>
            <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center group-hover:scale-105 transition-transform">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="my-2">
            <div className="text-3xl font-black font-mono text-slate-900">
              <Money amount={urgentClaims.reduce((sum, c) => sum + (c.requested_amount || 0), 0)} state="pending" />
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-purple-700 pt-2 border-t border-purple-100">
            <span>{urgentClaims.length} hồ sơ giám sát BR-37</span>
            <ArrowRight className="w-3.5 h-3.5 text-purple-600 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </div>
      </div>

      {/* Main 2-Column Operational Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (7 cols): Exception Action Queue */}
        <div className="lg:col-span-7 modern-card overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <div>
              <h3 className="font-bold text-sm text-slate-900">Hàng Đợi Ngoại Lệ Cần Can Thiệp Hôm Nay</h3>
              <p className="text-xs text-slate-500 mt-0.5">Tự động sắp xếp theo hạn SLA và mức tiền COD ưu tiên</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('exceptions')}
              className="btn-secondary text-xs"
            >
              Mở Hộp Việc →
            </button>
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="modern-table">
              <thead>
                <tr>
                  <th>Mã Vận Đơn</th>
                  <th>Hãng</th>
                  <th>Sự Cố Báo</th>
                  <th className="text-right">Tiền COD</th>
                  <th>Hạn SLA</th>
                  <th className="text-right">Thao Tác</th>
                </tr>
              </thead>
              <tbody>
                {exceptions.slice(0, 5).map((e) => (
                  <tr key={e.id}>
                    <td>
                      <TrackingCode code={e.tracking_code} onClick={() => onNavigate('exceptions')} />
                    </td>
                    <td>
                      <AutomationBadge tier={e.carrier_code === 'GHN' ? 'L2' : 'L1'} carrierCode={e.carrier_code} />
                    </td>
                    <td className="font-medium text-slate-800 text-xs truncate max-w-[160px]">
                      {e.reason || e.carrier_reason || 'Khách không nghe máy'}
                    </td>
                    <td className="text-right font-bold text-xs">
                      <Money amount={e.cod_amount} state="pending" />
                    </td>
                    <td>
                      <span className="badge-warn font-mono text-[10px]">
                        Còn {e.hours_remaining ?? 4}h
                      </span>
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => onNavigate('exceptions')}
                        className="btn-primary text-[11px] py-1 px-2.5"
                      >
                        Cứu đơn
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column (5 cols): 7-Day Rescue Trend */}
        <div className="lg:col-span-5 modern-card p-5 flex flex-col justify-between space-y-4">
          <div className="flex justify-between items-start border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-sm text-slate-900">Hiệu Quả Cứu Đơn 7 Ngày (CN-10)</h3>
              <p className="text-xs text-slate-500 mt-0.5">Tỷ lệ cứu thành công duy trì &gt; 80%</p>
            </div>
            <span className="badge-ok text-xs font-bold">84% Thành công</span>
          </div>

          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={WEEKLY_TREND} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                <defs>
                  <linearGradient id="rescuedGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="failGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#EF4444" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#F1F5F9" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0F172A', borderRadius: '8px', border: 'none', color: '#FFFFFF', fontSize: '11px' }}
                />
                <Area type="monotone" dataKey="failCount" name="Sự cố giao thất bại" stroke="#EF4444" strokeWidth={2} fillOpacity={1} fill="url(#failGrad)" />
                <Area type="monotone" dataKey="rescuedCount" name="Đơn cứu thành công" stroke="#10B981" strokeWidth={2} fillOpacity={1} fill="url(#rescuedGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
              <span>Sự cố hãng báo</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <span>Cứu thành công (BR-50)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
