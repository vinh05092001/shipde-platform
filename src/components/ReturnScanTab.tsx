'use client';

import React, { useState } from 'react';
import { TrackingCode, StatusBadge } from './ui/OperationalComponents';
import { RotateCcw, QrCode, Wifi, WifiOff, Camera, CheckCircle2, AlertTriangle, Upload, RefreshCw, Layers } from 'lucide-react';

export const ReturnScanTab: React.FC = () => {
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [conditionInput, setConditionInput] = useState<'intact' | 'damaged' | 'missing_item'>('intact');
  const [hasPhoto, setHasPhoto] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ type: 'ok' | 'risk' | 'warn'; msg: string } | null>(null);

  const [offlineQueue, setOfflineQueue] = useState<any[]>([]);
  const [history, setHistory] = useState([
    { id: 'rec_1', tracking_code: 'GHN88290111', warehouse: 'Kho Tân Bình, HCM', condition: 'intact', scanned_at: '17/08/2026 08:15', staff: 'Phạm Văn Kho' },
    { id: 'rec_2', tracking_code: 'GHTK77129002', warehouse: 'Kho Tân Bình, HCM', condition: 'damaged', scanned_at: '17/08/2026 08:30', staff: 'Phạm Văn Kho', evidence_url: 'https://storage.shipde.net/evidence/img_02.jpg' },
  ]);

  const handleScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = barcodeInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code) return;

    // BR-36: Kiện hỏng bắt buộc có ảnh
    if (conditionInput !== 'intact' && !hasPhoto) {
      setToastMessage({
        type: 'risk',
        msg: 'Lỗi 422 evidence_required (BR-36): Kiện hàng hư hỏng bắt buộc phải chụp ảnh làm chứng cứ khiếu nại hãng.',
      });
      return;
    }

    const newItem = {
      id: `scan_${Date.now()}`,
      tracking_code: code,
      warehouse: 'Kho Tân Bình, HCM',
      condition: conditionInput,
      scanned_at: new Date().toLocaleTimeString('vi-VN') + ' ' + new Date().toLocaleDateString('vi-VN'),
      staff: 'Phạm Văn Kho (Thủ kho)',
      evidence_url: hasPhoto ? 'https://storage.shipde.net/evidence/photo_proof.jpg' : undefined,
    };

    if (isOfflineMode) {
      setOfflineQueue((prev) => [newItem, ...prev]);
      setToastMessage({
        type: 'warn',
        msg: `[Chế độ Ngoại tuyến] Đã lưu mã ${code} vào hàng đợi SQLite cục bộ (${offlineQueue.length + 1} kiện chờ đồng bộ).`,
      });
    } else {
      setHistory((prev) => [newItem, ...prev]);
      setToastMessage({
        type: 'ok',
        msg: `Đã xác nhận nhận kiện hoàn ${code} vào kho Tân Bình thành công (CN-12).`,
      });
    }

    setBarcodeInput('');
    setHasPhoto(false);
    setConditionInput('intact');
  };

  const handleSyncOffline = () => {
    if (offlineQueue.length === 0) return;
    setHistory((prev) => [...offlineQueue, ...prev]);
    setToastMessage({
      type: 'ok',
      msg: `Đã đồng bộ ${offlineQueue.length} lệnh quét từ thiết bị lên máy chủ thành công (Khử trùng lặp lũy đẳng BR-40).`,
    });
    setOfflineQueue([]);
  };

  return (
    <div className="w-full space-y-6">
      {toastMessage && (
        <div
          className={`p-3.5 rounded-xl text-xs font-semibold flex items-center justify-between shadow-sm animate-in fade-in border ${
            toastMessage.type === 'ok'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
              : toastMessage.type === 'risk'
              ? 'bg-rose-50 text-rose-900 border-rose-200'
              : 'bg-amber-50 text-amber-900 border-amber-200'
          }`}
        >
          <span>{toastMessage.msg}</span>
          <button type="button" onClick={() => setToastMessage(null)} className="font-bold">✕</button>
        </div>
      )}

      {/* Top Scanner & Mode Switcher Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Scanner Terminal (7 cols) */}
        <div className="lg:col-span-7 modern-card p-6 space-y-5">
          <div className="flex justify-between items-center border-b border-slate-100 pb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-900">Máy Quét Nhận Hàng Hoàn Kho (CN-12)</h3>
                <p className="text-xs text-slate-500 mt-0.5">Kho chỉ định: Tân Bình, TP. Hồ Chí Minh</p>
              </div>
            </div>

            {/* Offline Toggle */}
            <button
              type="button"
              onClick={() => setIsOfflineMode(!isOfflineMode)}
              className={`btn-secondary text-xs ${
                isOfflineMode ? 'bg-amber-50 text-amber-900 border-amber-200 font-bold' : ''
              }`}
            >
              {isOfflineMode ? <WifiOff className="w-3.5 h-3.5 mr-1" /> : <Wifi className="w-3.5 h-3.5 mr-1" />}
              <span>{isOfflineMode ? 'Ngoại Tuyến (SQLite)' : 'Trực Tuyến (Live)'}</span>
            </button>
          </div>

          <form onSubmit={handleScanSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-900 block mb-1.5">
                Nhập hoặc Quét Barcode Mã Vận Đơn (A6 / Súng quét barcode):
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  placeholder="Quét mã vạch (GHN88290111, GHTK77129002)..."
                  className="modern-input flex-1 font-mono text-sm font-bold uppercase"
                  autoFocus
                />
                <button type="submit" className="btn-primary px-5">
                  Xác Nhận Quét
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Tình trạng kiện hàng khi nhận:
                </label>
                <select
                  value={conditionInput}
                  onChange={(e: any) => setConditionInput(e.target.value)}
                  className="modern-input w-full text-xs font-semibold"
                >
                  <option value="intact">1. Nguyên vẹn (Không hư hỏng)</option>
                  <option value="damaged">2. Bị móp méo / Rách bao bì (Hỏng)</option>
                  <option value="missing_item">3. Thiếu phụ kiện / Sai hàng</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Ảnh chụp chứng cứ (BR-36):
                </label>
                <button
                  type="button"
                  onClick={() => setHasPhoto(!hasPhoto)}
                  className={`btn-secondary w-full text-xs justify-between ${
                    hasPhoto ? 'bg-emerald-50 text-emerald-800 border-emerald-200 font-bold' : ''
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Camera className="w-4 h-4" />
                    {hasPhoto ? 'Đã đính kèm ảnh chụp' : 'Chụp ảnh kiện hàng'}
                  </span>
                  {hasPhoto && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                </button>
              </div>
            </div>

            {conditionInput !== 'intact' && !hasPhoto && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs">
                * <strong>Bắt buộc theo BR-36:</strong> Kiện hàng có vấn đề phải chụp ảnh đính kèm trước khi bấm lưu.
              </div>
            )}
          </form>
        </div>

        {/* Offline Queue Drawer Status (5 cols) */}
        <div className="lg:col-span-5 modern-card p-6 flex flex-col justify-between space-y-4">
          <div className="border-b border-slate-100 pb-3 flex justify-between items-center">
            <div>
              <h3 className="font-bold text-sm text-slate-900">Hàng Đợi Ngoại Tuyến (CN-22)</h3>
              <p className="text-xs text-slate-500 mt-0.5">Chỉ thêm, không sửa — Khử trùng lặp lũy đẳng</p>
            </div>
            <span className="badge-muted text-xs font-bold">{offlineQueue.length} lệnh chờ</span>
          </div>

          <div className="text-xs space-y-2 flex-1">
            {offlineQueue.length === 0 ? (
              <div className="py-8 text-center text-slate-400 text-xs">
                Không có lệnh quét ngoại tuyến nào đang tồn đọng.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar">
                {offlineQueue.map((q, idx) => (
                  <div key={idx} className="p-2 bg-slate-50 border border-slate-200/80 rounded-lg flex justify-between items-center text-xs">
                    <span className="font-mono font-bold text-slate-900">{q.tracking_code}</span>
                    <span className="text-slate-600">{q.condition === 'intact' ? 'Nguyên vẹn' : 'Hư hỏng'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            disabled={offlineQueue.length === 0}
            onClick={handleSyncOffline}
            className="btn-primary w-full justify-center disabled:opacity-40"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Đồng bộ {offlineQueue.length} lệnh lên máy chủ (BR-40)</span>
          </button>
        </div>
      </div>

      {/* Scanned Return Receipts Table */}
      <div className="modern-card overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
          <h3 className="font-bold text-sm text-slate-900">
            Nhật Ký Quét Nhận Hàng Hoàn Trong Ngày ({history.length} kiện)
          </h3>
          <span className="text-xs text-slate-500">Khóa bản ghi: (Mã kiện, Kho, Kỳ)</span>
        </div>

        <div className="overflow-x-auto">
          <table className="modern-table">
            <thead>
              <tr>
                <th>Mã Vận Đơn</th>
                <th>Kho Nhận</th>
                <th>Tình Trạng Kiện</th>
                <th>Thời Gian Quét</th>
                <th>Thủ Kho Thực Hiện</th>
                <th>Bằng Chứng Ảnh (BR-36)</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td><TrackingCode code={h.tracking_code} /></td>
                  <td className="text-xs">{h.warehouse}</td>
                  <td>
                    <span className={h.condition === 'intact' ? 'badge-ok' : 'badge-risk'}>
                      {h.condition === 'intact' ? 'Nguyên vẹn' : 'Bị hư hỏng'}
                    </span>
                  </td>
                  <td className="font-mono text-xs text-slate-500">{h.scanned_at}</td>
                  <td className="text-xs text-slate-600">{h.staff}</td>
                  <td>
                    {h.evidence_url ? (
                      <a href={h.evidence_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-xs font-semibold">
                        Xem ảnh chứng cứ
                      </a>
                    ) : (
                      <span className="text-slate-400 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
