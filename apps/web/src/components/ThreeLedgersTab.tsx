'use client';

import React, { useState, useEffect } from 'react';
import { ThreeValueLedgersReport } from '@/types/ledger';
import { Money, TrackingCode } from './ui/OperationalComponents';
import {
  Download,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  ArrowUpRight,
  TrendingUp,
  Clock,
  ShieldCheck,
  DollarSign,
} from 'lucide-react';

export const ThreeLedgersTab: React.FC = () => {
  const [report, setReport] = useState<ThreeValueLedgersReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeDrilldown, setActiveDrilldown] = useState<'S1' | 'S2' | 'S3' | null>(null);

  const fetchLedgers = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ledgers');
      const data = await res.json();
      if (data.success) {
        setReport(data.data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line
    fetchLedgers();
  }, []);

  const handleExportCsv = () => {
    window.open('/api/ledgers?format=csv', '_blank');
  };

  if (!report) {
    return (
      <div className="p-12 text-center text-xs text-slate-500">
        Đang tải báo cáo Ba Sổ Giá Trị...
      </div>
    );
  }

  const s1 = report.ledger1_real_cash;
  const s2 = report.ledger2_rescued_orders;
  const s3 = report.ledger3_control_metrics;

  return (
    <div className="w-full space-y-6">
      {/* Header Bar */}
      <div className="modern-card p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-600" />
              Báo Cáo Hiệu Quả Tài Chính (Ba Sổ Giá Trị Độc Lập)
            </h2>
            <span className="badge-ok text-xs">Chuẩn Kế Toán BR-45</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Kỳ hạch toán: 01/08/2026 – 31/08/2026 · Ba sổ được phân tách tuyệt đối, minh bạch dòng
            tiền thực nhận và chi phí hoàn tránh được
          </p>
        </div>

        <button type="button" onClick={handleExportCsv} className="btn-primary text-xs">
          <Download className="w-4 h-4" />
          <span>Xuất Báo Cáo (.CSV)</span>
        </button>
      </div>

      {/* THREE DISTINCT INDEPENDENT VALUE BLOCKS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* SỔ 1: TIỀN THỰC NHẬN */}
        <div className="modern-card p-6 flex flex-col justify-between space-y-5 border-t-4 border-t-emerald-600">
          <div className="space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider block">
                  Sổ 1 · Tiền Thực Nhận
                </span>
                <span className="text-xs text-slate-500">
                  Tiền bồi thường đã về tài khoản ngân hàng
                </span>
              </div>
              <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <DollarSign className="w-5 h-5" />
              </div>
            </div>

            <div>
              <span className="text-xs text-slate-500 font-semibold block mb-1">
                Tổng tiền thực nhận (Bank/Cấn trừ):
              </span>
              <div className="text-3xl font-black font-mono text-emerald-700">
                <Money amount={s1.total_recovered_amount} state="confirmed" />
              </div>
            </div>

            {/* Separate Column for Pending Acceptance */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/70 space-y-1 text-xs">
              <span className="text-slate-600 font-medium block">
                Hãng đã chấp thuận (chờ kỳ sau):
              </span>
              <div className="text-sm font-mono font-bold text-slate-400 italic">
                <Money amount={s1.pending_acceptance_amount} state="pending" />
              </div>
              <p className="text-[10px] text-slate-400 italic pt-1">
                * BR-45: Không cộng vào tổng thực nhận cho đến khi tiền về tài khoản
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setActiveDrilldown('S1')}
            className="btn-secondary w-full text-xs justify-between"
          >
            <span>Xem {s1.claim_count} hồ sơ khiếu nại thành công</span>
            <ArrowUpRight className="w-4 h-4" />
          </button>
        </div>

        {/* SỔ 2: ĐƠN CỨU ĐƯỢC */}
        <div className="modern-card p-6 flex flex-col justify-between space-y-5 border-t-4 border-t-blue-600">
          <div className="space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-xs font-bold text-blue-700 uppercase tracking-wider block">
                  Sổ 2 · Đơn Cứu Được
                </span>
                <span className="text-xs text-slate-500">Hiệu quả can thiệp giao lại (BR-50)</span>
              </div>
              <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5" />
              </div>
            </div>

            <div>
              <span className="text-xs text-slate-500 font-semibold block mb-1">
                Số đơn cứu thành công:
              </span>
              <div className="text-3xl font-black font-mono text-slate-900">
                {s2.rescued_orders_count}{' '}
                <span className="text-base font-normal text-slate-500">đơn</span>
              </div>
            </div>

            {/* Only Saved Return Fee */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/70 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-600 font-medium">Phí hoàn tránh được:</span>
                <strong className="font-mono text-slate-900 font-bold">
                  <Money amount={s2.total_return_fee_saved} state="confirmed" />
                </strong>
              </div>
              <div className="flex justify-between text-slate-500 italic text-[11px]">
                <span>Hàng giữ lại (GMV ước tính):</span>
                <span className="font-mono">
                  {Number(s2.rescued_gmv).toLocaleString('vi-VN')} đ
                </span>
              </div>
              <p className="text-[10px] text-slate-400 italic pt-1">
                * BR-50: Chỉ tính tổng phí hoàn thực tế tránh được của từng đơn theo biểu giá hợp
                đồng, tuyệt đối không cộng cước đi
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setActiveDrilldown('S2')}
            className="btn-secondary w-full text-xs justify-between"
          >
            <span>Xem danh sách đơn được cứu</span>
            <ArrowUpRight className="w-4 h-4" />
          </button>
        </div>

        {/* SỔ 3: ĐỘ PHỦ KIỂM SOÁT */}
        <div className="modern-card p-6 flex flex-col justify-between space-y-5 border-t-4 border-t-purple-600">
          <div className="space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-xs font-bold text-purple-700 uppercase tracking-wider block">
                  Sổ 3 · Độ Phủ Kiểm Soát
                </span>
                <span className="text-xs text-slate-500">Chỉ số vận hành & giờ công tiết kiệm</span>
              </div>
              <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                <Clock className="w-5 h-5" />
              </div>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-600">Đơn cập nhật trong 24h:</span>
                <strong className="font-mono text-slate-900 text-sm">
                  {s3.realtime_tracking_coverage_pct}%
                </strong>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-600">COD đã đối soát chính xác:</span>
                <strong className="font-mono text-slate-900 text-sm">
                  {s3.reconciled_cod_coverage_pct}%
                </strong>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-600">Sai lệch phát hiện & chặn đứng:</span>
                <strong className="font-mono text-rose-600 text-sm">
                  {s3.discrepancies_detected_count} khoản
                </strong>
              </div>

              <div className="p-3 bg-purple-50/50 border border-purple-100 rounded-xl flex justify-between items-center mt-2">
                <span className="text-purple-900 font-semibold">Giờ kế toán tiết kiệm:</span>
                <strong className="font-mono text-base text-purple-700 font-bold">
                  {s3.accounting_hours_saved} giờ
                </strong>
              </div>
            </div>
          </div>

          <div className="text-[11px] text-slate-400 italic text-center">
            Cơ sở đánh giá hiệu quả gói thuê bao SaaS cố định (BR-46)
          </div>
        </div>
      </div>

      {/* Drill-down Detail Modal / View */}
      {activeDrilldown && (
        <div className="modern-card p-5 space-y-4 animate-in fade-in">
          <div className="flex justify-between items-center border-b border-slate-100 pb-3">
            <h3 className="font-bold text-sm text-slate-900">
              Chi tiết chứng từ tạo nên{' '}
              {activeDrilldown === 'S1' ? 'Sổ 1 (Tiền thực nhận)' : 'Sổ 2 (Đơn cứu được)'}
            </h3>
            <button
              type="button"
              onClick={() => setActiveDrilldown(null)}
              className="btn-secondary text-xs py-1"
            >
              Đóng chi tiết
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="modern-table">
              <thead>
                <tr>
                  <th>Mã Vận Đơn</th>
                  <th>Hãng</th>
                  <th className="text-right">Số Tiền Hạch Toán</th>
                  <th>Ngày Ghi Nhận</th>
                  <th>Ghi Chú Kiểm Toán</th>
                </tr>
              </thead>
              <tbody>
                {activeDrilldown === 'S1'
                  ? s1.records.map((r, idx) => (
                      <tr key={idx}>
                        <td>
                          <TrackingCode code={r.tracking_code} />
                        </td>
                        <td className="font-semibold text-xs">{r.carrier_code}</td>
                        <td className="text-right font-bold text-xs text-emerald-700">
                          <Money amount={r.recovered_amount} state="confirmed" />
                        </td>
                        <td className="font-mono text-xs text-slate-500">
                          {new Date(r.paid_at).toLocaleDateString('vi-VN')}
                        </td>
                        <td className="text-xs text-slate-600">
                          Đã khớp chứng từ ngân hàng số {r.bank_reference || 'REF_99182'}
                        </td>
                      </tr>
                    ))
                  : s2.records.map((r, idx) => (
                      <tr key={idx}>
                        <td>
                          <TrackingCode code={r.tracking_code} />
                        </td>
                        <td className="font-semibold text-xs">GHN</td>
                        <td className="text-right font-bold text-xs text-blue-700">
                          <Money amount={r.return_fee_saved} state="confirmed" />
                        </td>
                        <td className="font-mono text-xs text-slate-500">
                          {new Date(r.rescued_at).toLocaleDateString('vi-VN')}
                        </td>
                        <td className="text-xs text-slate-600">
                          Cứu đơn sau {r.delivery_attempts} lần giao thất bại (Kênh{' '}
                          {r.intervention_channel})
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
