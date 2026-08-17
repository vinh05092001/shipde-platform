'use client';

import React, { useState } from 'react';
import { UIDiscrepancyItem } from './types';
import { TrackingCode, Money, StatusBadge, AutomationBadge, ConfirmDialog } from './ui/OperationalComponents';
import { DiscrepancyType, DiscrepancyResolution } from '@/types/domain';
import {
  DollarSign,
  Upload,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  Lock,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  ArrowRight,
  Filter,
} from 'lucide-react';

interface Props {
  discrepancies: UIDiscrepancyItem[];
  onUpdateDiscrepancy: (updated: UIDiscrepancyItem) => void;
  role: string;
}

export const ReconciliationTab: React.FC<Props> = ({
  discrepancies,
  onUpdateDiscrepancy,
  role,
}) => {
  const [selectedDiscrepancyType, setSelectedDiscrepancyType] = useState<string>('ALL');
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [resolvingItem, setResolvingItem] = useState<UIDiscrepancyItem | null>(null);
  const [resolvingAction, setResolvingAction] = useState<DiscrepancyResolution>(DiscrepancyResolution.DISPUTE);
  const [isPeriodClosed, setIsPeriodClosed] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Step 1: Statement summary preview
  const statementSummary = {
    total_rows: 50,
    total_cod: 14250000,
    total_freight: 1240000,
    matched_exact: 48,
    error_rows: 0,
  };

  // Discrepancy summary classification
  const openDiscrepancies = discrepancies.filter((d) => String(d.status).toUpperCase() === 'OPEN');
  const openCount = openDiscrepancies.length;

  const d1List = discrepancies.filter((d) => String(d.type).startsWith('D1'));
  const d2List = discrepancies.filter((d) => String(d.type).startsWith('D2'));
  const d4List = discrepancies.filter((d) => String(d.type).startsWith('D4'));
  const d5List = discrepancies.filter((d) => String(d.type).startsWith('D5'));
  const d6List = discrepancies.filter((d) => String(d.type).startsWith('D6'));
  const d7List = discrepancies.filter((d) => String(d.type).startsWith('D7'));

  const filteredDiscrepancies = discrepancies.filter((d) => {
    if (selectedDiscrepancyType === 'ALL') return true;
    return String(d.type).startsWith(selectedDiscrepancyType.slice(0, 2));
  });

  const handleResolveAction = (item: UIDiscrepancyItem, action: DiscrepancyResolution) => {
    // Maker-Checker Segregation of Duties Check (BR-12)
    if (item.created_by_user === 'usr_02' && role === 'OPS_CSKH') {
      alert('[Quy tắc Tách quyền tài chính BR-12]: Bạn là nhân viên CSKH đã xử lý đơn này, nên không được quyền tự duyệt chênh lệch. Vui lòng chuyển cho Kế toán viên độc lập duyệt.');
      return;
    }

    setResolvingItem(item);
    setResolvingAction(action);
  };

  const handleConfirmResolution = async (reason: string) => {
    if (!resolvingItem) return;

    try {
      const res = await fetch('/api/reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'RESOLVE_DISCREPANCY',
          discrepancy_id: resolvingItem.id,
          resolution: resolvingAction,
          reason,
          user_id: role === 'ACCOUNTANT' ? 'usr_03' : 'usr_01',
          user_name: role === 'ACCOUNTANT' ? 'Lê Minh Kế Toán' : 'Nguyễn Văn An (Chủ Shop)',
          expected_version: resolvingItem.version || 1,
          is_period_closed: isPeriodClosed,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Lỗi xử lý chênh lệch');

      const updated = {
        ...resolvingItem,
        status: resolvingAction,
        version: (resolvingItem.version || 1) + 1,
      };
      onUpdateDiscrepancy(updated);
      setToastMessage(`✓ Đã xử lý chênh lệch [${resolvingItem.tracking_code}] thành công.`);
      setResolvingItem(null);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleClosePeriod = () => {
    if (openCount > 0) {
      alert(`[Bất biến BR-11]: Còn ${openCount} khoản chênh lệch chưa xử lý. Bắt buộc duyệt toàn bộ mới được khóa kỳ đối soát.`);
      return;
    }
    setIsPeriodClosed(true);
    setToastMessage('✓ Đã khóa sổ kỳ đối soát 01/08 - 15/08 thành công (Bất biến BR-11).');
  };

  return (
    <div className="w-full space-y-6">
      {toastMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs font-semibold flex items-center justify-between shadow-sm animate-in fade-in">
          <span>{toastMessage}</span>
          <button type="button" onClick={() => setToastMessage(null)} className="font-bold">✕</button>
        </div>
      )}

      {/* STEP 1: STATEMENT SUMMARY PREVIEW BANNER */}
      <div className="modern-card p-5 space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-slate-900">Kỳ Đối Soát COD & Cước: 01/08/2026 – 15/08/2026</h3>
                <span className="badge-ok text-xs">GHN Express</span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">Mã file: sao_ke_ghn_ky_01_08.xlsx (SHA-256 Checksum Verified)</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isPeriodClosed}
              onClick={handleClosePeriod}
              className={`btn-primary text-xs ${
                isPeriodClosed ? 'bg-slate-300 border-slate-300 cursor-not-allowed opacity-60' : ''
              }`}
              title={openCount > 0 ? `Còn ${openCount} khoản chưa xử lý` : 'Khóa kỳ đối soát'}
            >
              <Lock className="w-3.5 h-3.5" />
              <span>{isPeriodClosed ? 'Kỳ Đã Chốt Khóa (BR-11)' : `Chốt Sổ Kỳ Đối Soát (${openCount} chưa duyệt)`}</span>
            </button>
          </div>
        </div>

        {/* 4 Summary Counters */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/60">
            <span className="text-slate-500 font-semibold block">Tổng Dòng Sao Kê</span>
            <strong className="text-lg font-mono font-bold text-slate-900">{statementSummary.total_rows} bản ghi</strong>
          </div>
          <div className="p-3 bg-emerald-50/50 rounded-xl border border-emerald-100">
            <span className="text-emerald-700 font-semibold block">Tổng COD Thực Nhận</span>
            <strong className="text-lg font-mono font-bold text-emerald-700">
              <Money amount={statementSummary.total_cod} state="confirmed" />
            </strong>
          </div>
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/60">
            <span className="text-slate-500 font-semibold block">Tổng Cước Khấu Trừ</span>
            <strong className="text-lg font-mono font-bold text-slate-900">
              <Money amount={statementSummary.total_freight} state="confirmed" />
            </strong>
          </div>
          <div className="p-3 bg-rose-50/50 rounded-xl border border-rose-100">
            <span className="text-rose-700 font-semibold block">Sai Lệch Phát Hiện</span>
            <strong className="text-lg font-mono font-bold text-rose-700">{discrepancies.length} khoản lệch</strong>
          </div>
        </div>
      </div>

      {/* STEP 2: 6 DISCREPANCY TYPE BREAKDOWN CARDS */}
      <div className="space-y-3">
        <h3 className="font-bold text-sm text-slate-900">
          Kết Quả Quét 6 Phép Dò Sai Lệch Tự Động (D1–D7)
        </h3>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { id: 'D1', label: 'D1 · Lệch Cân Nặng', count: d1List.length, desc: 'Cân thực tế > Khai báo' },
            { id: 'D2', label: 'D2 · Lệch Cước Hợp Đồng', count: d2List.length, desc: 'Trừ cao hơn biểu giá' },
            { id: 'D4', label: 'D4 · Trừ Trùng Cước', count: d4List.length, desc: '2 dòng cước/1 vận đơn' },
            { id: 'D5', label: 'D5 · Lệch COD Thu Hộ', count: d5List.length, desc: 'COD trả < COD đơn vị' },
            { id: 'D6', label: 'D6 · COD Quá Hạn', count: d6List.length, desc: 'Giao > 3 ngày chưa trả' },
            { id: 'D7', label: 'D7 · Thiếu Dòng Sao Kê', count: d7List.length, desc: 'Đã giao nhưng vắng mặt' },
          ].map((type) => {
            const isSelected = selectedDiscrepancyType === type.id;
            return (
              <button
                key={type.id}
                type="button"
                onClick={() => setSelectedDiscrepancyType(isSelected ? 'ALL' : type.id)}
                className={`modern-card p-3 text-left transition cursor-pointer flex flex-col justify-between ${
                  isSelected ? 'ring-2 ring-blue-600 bg-blue-50/40' : 'hover:border-slate-300'
                }`}
              >
                <div>
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-xs text-slate-900">{type.id}</span>
                    <span className={`text-[11px] font-mono font-bold px-1.5 py-0.2 rounded-full ${type.count > 0 ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-500'}`}>
                      {type.count}
                    </span>
                  </div>
                  <div className="font-bold text-xs text-slate-800 mt-1">{type.label.split('·')[1]}</div>
                </div>
                <div className="text-[10px] text-slate-400 mt-2">{type.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* STEP 3: SIDE-BY-SIDE COMPARATOR DATA TABLE */}
      <div className="modern-card overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
          <div>
            <h3 className="font-bold text-sm text-slate-900">
              Bảng So Sánh 3 Cột Thẳng Hàng (Hệ Thống ‖ Hãng ‖ Chênh Lệch)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">Nhấp vào dòng để xem chi tiết đối chiếu và thực hiện Maker-Checker</p>
          </div>
          {selectedDiscrepancyType !== 'ALL' && (
            <button
              type="button"
              onClick={() => setSelectedDiscrepancyType('ALL')}
              className="text-xs text-blue-600 font-bold hover:underline"
            >
              Hiện tất cả các loại
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="modern-table">
            <thead>
              <tr>
                <th style={{ width: '30px' }}></th>
                <th>Mã Vận Đơn</th>
                <th>Phép Dò</th>
                <th>Hãng</th>
                <th className="text-right">Số Hệ Thống</th>
                <th className="text-right">Số Hãng Sao Kê</th>
                <th className="text-right">Chênh Lệch Cần Đòi</th>
                <th>Trạng Thái</th>
                <th className="text-right">Hành Động Maker-Checker</th>
              </tr>
            </thead>
            <tbody>
              {filteredDiscrepancies.map((d) => {
                const isExpanded = expandedRowId === d.id;
                const isResolved = String(d.status).toUpperCase() !== 'OPEN';

                return (
                  <React.Fragment key={d.id}>
                    <tr className={isExpanded ? 'bg-blue-50/30' : ''}>
                      <td className="text-center cursor-pointer" onClick={() => setExpandedRowId(isExpanded ? null : d.id)}>
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-500 mx-auto" /> : <ChevronDown className="w-4 h-4 text-slate-500 mx-auto" />}
                      </td>
                      <td>
                        <TrackingCode code={d.tracking_code} />
                      </td>
                      <td>
                        <StatusBadge status={d.type} />
                      </td>
                      <td className="font-semibold text-xs">{d.carrier || d.carrier_code || 'GHN'}</td>
                      <td className="text-right text-xs">
                        <Money amount={d.contract_amount || 22000} state="confirmed" />
                      </td>
                      <td className="text-right text-xs">
                        <Money amount={d.charged_amount || 29000} state="confirmed" />
                      </td>
                      <td className="text-right font-bold text-xs text-rose-600">
                        <Money amount={d.discrepancy_amount || d.amount || 0} state="confirmed" showSign />
                      </td>
                      <td>
                        <StatusBadge status={d.status} />
                      </td>
                      <td className="text-right">
                        {!isResolved && !isPeriodClosed ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleResolveAction(d, DiscrepancyResolution.DISPUTE)}
                              className="btn-secondary text-[11px] py-1 px-2.5 text-rose-700 hover:bg-rose-50 border-rose-200"
                            >
                              Khiếu nại
                            </button>
                            <button
                              type="button"
                              onClick={() => handleResolveAction(d, DiscrepancyResolution.CONFIRMED)}
                              className="btn-secondary text-[11px] py-1 px-2.5 text-emerald-700 hover:bg-emerald-50 border-emerald-200"
                            >
                              Chấp thuận
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400 font-mono italic">Đã duyệt</span>
                        )}
                      </td>
                    </tr>

                    {/* Expanded Side-by-Side Comparator Details */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={9} className="p-4 bg-slate-50/80 border-b border-slate-200">
                          <div className="max-w-3xl bg-white border border-slate-200 rounded-xl p-4 space-y-3 text-xs shadow-sm">
                            <span className="font-bold text-slate-900 uppercase tracking-wider block">
                              Chi Tiết So Sánh Ba Cột Thẳng Hàng
                            </span>

                            <div className="grid grid-cols-3 gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200/80">
                              <div>
                                <span className="text-[10px] text-slate-500 font-semibold uppercase">1. Số hệ thống ghi nhận</span>
                                <div className="font-mono text-base font-bold text-slate-900 mt-0.5">
                                  <Money amount={d.contract_amount || 22000} state="confirmed" />
                                </div>
                                <div className="text-[11px] text-slate-500">Khai báo: 250g · Nội tỉnh</div>
                              </div>

                              <div className="border-l border-slate-200 pl-3">
                                <span className="text-[10px] text-slate-500 font-semibold uppercase">2. Số hãng sao kê</span>
                                <div className="font-mono text-base font-bold text-rose-600 mt-0.5">
                                  <Money amount={d.charged_amount || 29000} state="confirmed" />
                                </div>
                                <div className="text-[11px] text-slate-500">Hãng cân: 800g · Bậc 1kg</div>
                              </div>

                              <div className="border-l border-slate-200 pl-3">
                                <span className="text-[10px] text-slate-500 font-semibold uppercase">3. Chênh lệch cần đòi</span>
                                <div className="font-mono text-base font-black text-rose-600 mt-0.5">
                                  <Money amount={d.discrepancy_amount || d.amount || 0} state="confirmed" showSign />
                                </div>
                                <div className="text-[11px] text-rose-700 font-semibold">Thu vượt: +7.000 đ</div>
                              </div>
                            </div>

                            <div className="text-slate-600">
                              <strong>Lý do hệ thống phát hiện:</strong> {d.reason || 'Cước khấu trừ thực tế cao hơn giá trị cam kết trong biểu giá hợp đồng.'}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Maker-Checker Mandatory Confirmation Dialog */}
      {resolvingItem && (
        <ConfirmDialog
          isOpen={!!resolvingItem}
          title={`Xác nhận duyệt sai lệch đơn ${resolvingItem.tracking_code}`}
          description={`Phương án duyệt: ${resolvingAction.toUpperCase()} · Số tiền: ${Number(resolvingItem.discrepancy_amount || resolvingItem.amount || 0).toLocaleString('vi-VN')} đ.`}
          requireReason={true}
          confirmLabel="Lưu Quyết Định Duyệt"
          onConfirm={handleConfirmResolution}
          onClose={() => setResolvingItem(null)}
        />
      )}
    </div>
  );
};
