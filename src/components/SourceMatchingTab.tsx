'use client';

import React, { useState } from 'react';
import { TrackingCode, Money, ConfirmDialog } from './ui/OperationalComponents';
import { Database, RefreshCw, Link2, Search, CheckCircle2, AlertTriangle, ShieldCheck, Sparkles } from 'lucide-react';

export const SourceMatchingTab: React.FC = () => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRow, setSelectedRow] = useState<any | null>(null);
  const [manualOrderCode, setManualOrderCode] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [unmatchedRows, setUnmatchedRows] = useState([
    { id: 'u_1', statement_tracking: 'GHN88290999', statement_fee: 25000, cod: 300000, date: '15/08/2026', carrier: 'GHN' },
    { id: 'u_2', statement_tracking: 'GHTK77128888', statement_fee: 32000, cod: 450000, date: '16/08/2026', carrier: 'GHTK' },
  ]);

  const handleSyncPancake = () => {
    setIsSyncing(true);
    setTimeout(() => {
      setIsSyncing(false);
      setToastMessage('✓ Đã đồng bộ 24 đơn mới từ Pancake POS Open API (CN-01).');
      setTimeout(() => setToastMessage(null), 3500);
    }, 1000);
  };

  const handleConfirmManualMatch = (reason: string) => {
    if (!selectedRow) return;
    setUnmatchedRows((prev) => prev.filter((r) => r.id !== selectedRow.id));
    setToastMessage(`✓ Đã ghép tay ${selectedRow.statement_tracking} -> Đơn ${manualOrderCode || 'ORD_ANAN_101'} (Ghi nhận audit: ${reason}).`);
    setSelectedRow(null);
    setManualOrderCode('');
    setTimeout(() => setToastMessage(null), 4000);
  };

  const filteredUnmatched = unmatchedRows.filter((r) =>
    r.statement_tracking.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="w-full space-y-6">
      {toastMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs font-semibold flex items-center justify-between shadow-sm animate-in fade-in">
          <span>{toastMessage}</span>
          <button type="button" onClick={() => setToastMessage(null)} className="font-bold">✕</button>
        </div>
      )}

      {/* Header & Sync Trigger */}
      <div className="modern-card p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Database className="w-5 h-5 text-blue-600" />
              Nguồn Đơn Pancake POS & Engine Ghép Mã 3 Tầng (CN-01..03)
            </h2>
            <span className="badge-ok text-xs">Chuẩn NFR-04 (&gt;95%)</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Đồng bộ đơn hàng tự động và đối chiếu sao kê qua Khóa 1 (Mã vận đơn), Khóa 2 (Mã đơn), Khóa 3 (Khớp mờ COD ±3 ngày)
          </p>
        </div>

        <button
          type="button"
          onClick={handleSyncPancake}
          disabled={isSyncing}
          className="btn-primary text-xs"
        >
          <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
          <span>{isSyncing ? 'Đang đồng bộ...' : 'Đồng Bộ Pancake POS'}</span>
        </button>
      </div>

      {/* 3-Tier Matching Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="modern-card p-5 space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="font-bold text-slate-700">Khóa 1 & 2 · Khớp Tuyệt Đối</span>
            <span className="badge-ok text-[11px]">NFR-04</span>
          </div>
          <div className="text-3xl font-black font-mono text-emerald-700">98.2%</div>
          <p className="text-xs text-slate-500">Khớp chính xác 100% qua tracking code hoặc mã đơn POS</p>
        </div>

        <div className="modern-card p-5 space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="font-bold text-slate-700">Khóa 3 · Khớp Mờ Thuật Toán</span>
            <span className="badge-info text-[11px]">Cửa sổ ±3 ngày</span>
          </div>
          <div className="text-3xl font-black font-mono text-blue-600">1.6%</div>
          <p className="text-xs text-slate-500">Khớp qua số tiền COD và ngày phát bưu kiện</p>
        </div>

        <div className="modern-card p-5 space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="font-bold text-rose-700">Hàng Đợi Ghép Tay</span>
            <span className="badge-risk text-[11px]">{unmatchedRows.length} dòng</span>
          </div>
          <div className="text-3xl font-black font-mono text-rose-600">
            {unmatchedRows.length} <span className="text-sm font-normal text-slate-500">chưa ghép</span>
          </div>
          <p className="text-xs text-slate-500">Cần CSKH đối chiếu thủ công và giải trình lý do (BR-22)</p>
        </div>
      </div>

      {/* Manual Matching Queue Table */}
      <div className="modern-card overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
          <div>
            <h3 className="font-bold text-sm text-slate-900">
              Hàng Đợi Dòng Sao Kê Chưa Ghép Được (CN-03)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">Nhấp để liên kết với đơn hàng trong hệ thống</p>
          </div>

          <div className="relative min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Lọc mã vận đơn..."
              className="modern-input pl-9 w-full text-xs"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="modern-table">
            <thead>
              <tr>
                <th>Mã Vận Đơn Sao Kê</th>
                <th>Hãng</th>
                <th className="text-right">Cước Sao Kê</th>
                <th className="text-right">Tiền COD</th>
                <th>Ngày Giao</th>
                <th>Trạng Thái</th>
                <th className="text-right">Thao Tác Ghép Tay</th>
              </tr>
            </thead>
            <tbody>
              {filteredUnmatched.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-slate-400 text-xs">
                    Toàn bộ dòng sao kê đã được ghép mã tự động 100%.
                  </td>
                </tr>
              ) : (
                filteredUnmatched.map((r) => (
                  <tr key={r.id}>
                    <td><TrackingCode code={r.statement_tracking} /></td>
                    <td className="font-semibold text-xs">{r.carrier}</td>
                    <td className="text-right text-xs"><Money amount={r.statement_fee} state="confirmed" /></td>
                    <td className="text-right font-bold text-xs"><Money amount={r.cod} state="confirmed" /></td>
                    <td className="font-mono text-xs text-slate-500">{r.date}</td>
                    <td><span className="badge-warn text-[10px]">Chưa ghép</span></td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedRow(r)}
                        className="btn-primary text-[11px] py-1 px-3"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                        <span>Ghép với đơn</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manual Matching Dialog */}
      {selectedRow && (
        <ConfirmDialog
          isOpen={!!selectedRow}
          title={`Ghép tay dòng sao kê ${selectedRow.statement_tracking}`}
          description={`Tiền COD: ${selectedRow.cod.toLocaleString('vi-VN')} đ · Cước: ${selectedRow.statement_fee.toLocaleString('vi-VN')} đ. Bắt buộc nhập lý do giải trình để ghi nhật ký kiểm toán (BR-22).`}
          requireReason={true}
          confirmLabel="Xác Nhận Ghép Mã"
          onConfirm={handleConfirmManualMatch}
          onClose={() => setSelectedRow(null)}
        />
      )}
    </div>
  );
};
