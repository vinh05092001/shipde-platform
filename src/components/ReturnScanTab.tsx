'use client';

import React, { useState, useRef } from 'react';
import { TrackingCode, StatusBadge } from './ui/OperationalComponents';
import {
  RotateCcw,
  QrCode,
  Wifi,
  WifiOff,
  Camera,
  CheckCircle2,
  AlertTriangle,
  Upload,
  RefreshCw,
  Package,
} from 'lucide-react';

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

  const inputRef = useRef<HTMLInputElement>(null);

  const handleScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = barcodeInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code) return;

    // Kiện hàng hư hỏng bắt buộc chụp ảnh làm chứng cứ
    if (conditionInput !== 'intact' && !hasPhoto) {
      setToastMessage({
        type: 'risk',
        msg: 'Kiện hàng hư hỏng hoặc thiếu hàng bắt buộc phải chụp ảnh làm bằng chứng khiếu nại.',
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
        msg: `[Chế độ Ngoại tuyến] Đã lưu mã ${code} vào hàng đợi cục bộ (${offlineQueue.length + 1} kiện chờ đồng bộ).`,
      });
    } else {
      setHistory((prev) => [newItem, ...prev]);
      setToastMessage({
        type: 'ok',
        msg: `Đã xác nhận nhận kiện hoàn ${code} vào kho Tân Bình thành công.`,
      });
    }

    setBarcodeInput('');
    setHasPhoto(false);
    setConditionInput('intact');
    if (inputRef.current) inputRef.current.focus();
  };

  const handleSyncOffline = () => {
    if (offlineQueue.length === 0) return;
    setHistory((prev) => [...offlineQueue, ...prev]);
    setToastMessage({
      type: 'ok',
      msg: `Đã đồng bộ ${offlineQueue.length} kiện hoàn từ máy quét lên máy chủ thành công.`,
    });
    setOfflineQueue([]);
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Toast */}
      {toastMessage && (
        <div
          className={`p-4 rounded-xl text-xs font-semibold flex items-center justify-between shadow-lg animate-in fade-in ${
            toastMessage.type === 'ok'
              ? 'bg-slate-900 text-white'
              : toastMessage.type === 'risk'
              ? 'bg-rose-900 text-white'
              : 'bg-amber-900 text-white'
          }`}
        >
          <div className="flex items-center gap-2">
            {toastMessage.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-400" />
            )}
            <span>{toastMessage.msg}</span>
          </div>
          <button type="button" onClick={() => setToastMessage(null)} className="font-bold text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Main Scanner Box */}
      <div className="modern-card p-6 md:p-8 space-y-6">
        <div className="flex justify-between items-center pb-4 border-b border-slate-100">
          <div>
            <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-[#EA4B12]" />
              <span>Tiếp Nhận & Quét Mã Kiện Hàng Hoàn</span>
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">Dành cho Thủ kho sử dụng máy quét mã vạch chuyên dụng hoặc camera điện thoại.</p>
          </div>

          {/* Offline Toggle */}
          <button
            type="button"
            onClick={() => setIsOfflineMode(!isOfflineMode)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              isOfflineMode
                ? 'bg-amber-50 text-amber-800 border border-amber-300'
                : 'bg-emerald-50 text-emerald-800 border border-emerald-300'
            }`}
          >
            {isOfflineMode ? <WifiOff className="w-3.5 h-3.5" /> : <Wifi className="w-3.5 h-3.5" />}
            <span>{isOfflineMode ? 'Ngoại Tuyến (Offline)' : 'Trực Tuyến'}</span>
          </button>
        </div>

        {/* Scan Input Form */}
        <form onSubmit={handleScanSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              Quét Hoặc Nhập Mã Vận Đơn:
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value.toUpperCase())}
                placeholder="Quét mã vạch (GHN8829..., GHTK7712...)"
                className="modern-input pl-10 text-base font-mono font-bold tracking-wider"
                autoFocus
              />
              <QrCode className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            </div>
          </div>

          {/* Package Condition Selector */}
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              Tình Trạng Kiện Hàng Khi Nhận:
            </label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { id: 'intact', label: 'Nguyên Vẹn', desc: 'Hộp nguyên seal, không móp rách' },
                { id: 'damaged', label: 'Hư Hỏng / Rách', desc: 'Bể vỡ, ướt hoặc rách hộp' },
                { id: 'missing_item', label: 'Thiếu Hàng', desc: 'Bị rạch bưu phẩm mất đồ' },
              ].map((cond) => (
                <button
                  key={cond.id}
                  type="button"
                  onClick={() => setConditionInput(cond.id as any)}
                  className={`p-3 rounded-xl text-left border transition cursor-pointer ${
                    conditionInput === cond.id
                      ? 'bg-[#FFF5F0] border-[#EA4B12] text-[#EA4B12]'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div className="font-bold text-xs">{cond.label}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{cond.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Photo Evidence (Mandatory if Damaged) */}
          {conditionInput !== 'intact' && (
            <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/50 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-amber-900 flex items-center gap-1.5">
                  <Camera className="w-4 h-4 text-amber-700" />
                  <span>Ảnh Chụp Hiện Trạng Kiện Hỏng (Bắt Buộc):</span>
                </span>
                {hasPhoto && <span className="badge-ok text-xs">✓ Đã Chụp Ảnh</span>}
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setHasPhoto(true)}
                  className="btn-secondary text-xs"
                >
                  <Camera className="w-4 h-4" />
                  <span>Mở Máy Ảnh Chụp</span>
                </button>
                <button
                  type="button"
                  onClick={() => setHasPhoto(true)}
                  className="btn-secondary text-xs"
                >
                  <Upload className="w-4 h-4" />
                  <span>Tải Ảnh Lên</span>
                </button>
              </div>
            </div>
          )}

          <button
            type="submit"
            className="btn-primary w-full justify-center text-sm py-2.5 font-bold"
          >
            Xác Nhận Nhập Kiện Vào Kho
          </button>
        </form>

        {/* Offline Queue Sync Bar */}
        {offlineQueue.length > 0 && (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex justify-between items-center">
            <span className="text-xs font-bold text-amber-900">
              Có {offlineQueue.length} kiện hàng đang chờ đồng bộ lên máy chủ
            </span>
            <button
              type="button"
              onClick={handleSyncOffline}
              className="btn-primary text-xs"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Đồng Bộ Ngay</span>
            </button>
          </div>
        )}
      </div>

      {/* History Log */}
      <div className="modern-card p-6 space-y-4">
        <h2 className="font-bold text-slate-900 text-sm">Lịch Sử Nhận Hàng Hoàn Gần Đây</h2>
        <div className="divide-y divide-slate-100">
          {history.map((item) => (
            <div key={item.id} className="py-3 flex justify-between items-center text-xs">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <TrackingCode code={item.tracking_code} />
                  <span className={item.condition === 'intact' ? 'badge-ok text-xs' : 'badge-risk text-xs'}>
                    {item.condition === 'intact' ? 'Nguyên Vẹn' : 'Hư Hỏng'}
                  </span>
                </div>
                <div className="text-slate-500">{item.warehouse} · {item.staff}</div>
              </div>
              <div className="text-slate-400 font-mono">{item.scanned_at}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
