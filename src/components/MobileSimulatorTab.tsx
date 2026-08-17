'use client';

import React, { useState } from 'react';
import {
  Smartphone,
  Wifi,
  WifiOff,
  Bell,
  CheckCircle2,
  AlertTriangle,
  QrCode,
  RotateCcw,
  Phone,
  Clock,
  ArrowRight,
  ShieldCheck,
  Send,
  Camera,
  Layers,
  ChevronLeft,
} from 'lucide-react';
import { TrackingCode, Money, StatusBadge, AutomationBadge } from './ui/OperationalComponents';

export const MobileSimulatorTab: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<number>(2); // Default to Screen 2 (Trang chủ)
  const [isOffline, setIsOffline] = useState(false);
  const [offlineQueueCount, setOfflineQueueCount] = useState(3);
  const [scannedCode, setScannedCode] = useState('GHN88290111');
  const [phoneInput, setPhoneInput] = useState('0912345678');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showMobileToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  return (
    <div className="w-full space-y-6">
      {/* Header Bar */}
      <div className="modern-card p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-blue-600" />
              Mô Phỏng Ứng Dụng Di Động Flutter (7 Màn Hình Chuẩn P7)
            </h2>
            <span className="badge-ok text-xs">Touch Target 48px</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Tối ưu cho CSKH cứu đơn lưu động và Thủ kho quét nhận hàng hoàn ngoại tuyến SQLite (BR-40)
          </p>
        </div>

        {/* Screen Switcher */}
        <div className="flex flex-wrap gap-1.5 text-xs font-semibold bg-slate-100 p-1.5 rounded-xl">
          {[
            { num: 1, label: 'M1: Đăng nhập' },
            { num: 2, label: 'M2: Trang chủ' },
            { num: 3, label: 'M3: Hộp việc' },
            { num: 4, label: 'M4: Chi tiết đơn' },
            { num: 5, label: 'M5: Hẹn giao lại' },
            { num: 6, label: 'M6: Quét hoàn kho' },
            { num: 7, label: 'M7: COD & Khiếu nại' },
          ].map((s) => (
            <button
              key={s.num}
              type="button"
              onClick={() => setCurrentScreen(s.num)}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                currentScreen === s.num
                  ? 'bg-blue-600 text-white shadow-xs font-bold'
                  : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Simulator Viewport (iPhone 15 Pro Titanium Frame) */}
      <div className="flex justify-center items-start py-4">
        <div className="w-[380px] bg-slate-950 p-4 rounded-[44px] shadow-2xl border-4 border-slate-700/80">
          {/* Mobile Screen Shell */}
          <div className="bg-slate-50 rounded-[34px] overflow-hidden flex flex-col h-[680px] text-xs relative">
            {/* Top iOS Status Bar & Dynamic Island */}
            <div className="bg-white px-6 pt-3 pb-2 flex justify-between items-center text-xs font-mono text-slate-900 border-b border-slate-100">
              <span className="font-bold">09:41</span>
              {/* Dynamic Island */}
              <div className="w-20 h-4 bg-slate-950 rounded-full mx-auto" />
              <div className="flex items-center gap-1.5">
                {isOffline ? (
                  <span className="badge-warn text-[9px] px-1.5 py-0">Offline</span>
                ) : (
                  <Wifi className="w-3.5 h-3.5 text-emerald-600" />
                )}
                <span className="text-[10px] font-bold">5G</span>
              </div>
            </div>

            {/* In-App Toast */}
            {toastMsg && (
              <div className="absolute top-14 left-4 right-4 z-50 bg-slate-900 text-white p-3 rounded-xl text-xs font-semibold shadow-lg animate-in slide-in-from-top-2">
                {toastMsg}
              </div>
            )}

            {/* Screen Content Viewport */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
              {/* SCREEN 1: LOGIN */}
              {currentScreen === 1 && (
                <div className="space-y-5 pt-8">
                  <div className="text-center space-y-1.5">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white font-bold text-2xl mx-auto flex items-center justify-center shadow-md">
                      S
                    </div>
                    <h3 className="font-bold text-lg text-slate-900">Ship Dễ Mobile</h3>
                    <p className="text-xs text-slate-500">Bàn điều khiển vận hành lưu động</p>
                  </div>

                  <div className="space-y-3 pt-4">
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1">Tài khoản nhân viên:</label>
                      <input type="text" defaultValue="cskh1@shopanan.vn" className="modern-input w-full text-xs h-11" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1">Mật khẩu:</label>
                      <input type="password" defaultValue="••••••••" className="modern-input w-full text-xs h-11" />
                    </div>
                    <button
                      type="button"
                      onClick={() => { setCurrentScreen(2); showMobileToast('✓ Đăng nhập CSKH thành công'); }}
                      className="btn-primary w-full h-12 text-sm justify-center font-bold mt-2"
                    >
                      Đăng Nhập
                    </button>
                  </div>
                </div>
              )}

              {/* SCREEN 2: HOME DASHBOARD */}
              {currentScreen === 2 && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs">
                    <div>
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Cửa hàng</span>
                      <strong className="text-sm font-bold text-slate-900">An An Boutique</strong>
                    </div>
                    <span className="badge-ok text-xs">CSKH Online</span>
                  </div>

                  {/* 2 Mobile KPI Cards */}
                  <div className="grid grid-cols-2 gap-3">
                    <div
                      onClick={() => setCurrentScreen(3)}
                      className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs cursor-pointer hover:border-rose-300"
                    >
                      <span className="text-[10px] text-rose-600 font-bold uppercase">Cần Cứu Gấp</span>
                      <div className="font-mono text-2xl font-bold text-rose-600 my-1">2 đơn</div>
                      <span className="text-[11px] text-slate-400">SLA còn 2h</span>
                    </div>

                    <div
                      onClick={() => setCurrentScreen(6)}
                      className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs cursor-pointer hover:border-blue-300"
                    >
                      <span className="text-[10px] text-slate-500 font-bold uppercase">Quét Hoàn Kho</span>
                      <div className="font-mono text-2xl font-bold text-slate-900 my-1">{offlineQueueCount} chờ</div>
                      <span className="text-[11px] text-emerald-700 font-semibold">SQLite Sync</span>
                    </div>
                  </div>

                  <div className="space-y-2 pt-1">
                    <span className="font-bold text-xs text-slate-900 block">Việc Cần Xử Lý Ngay:</span>
                    <div
                      onClick={() => setCurrentScreen(4)}
                      className="p-4 bg-white rounded-2xl border border-slate-200/80 shadow-xs space-y-1.5 cursor-pointer hover:border-blue-400"
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-mono font-bold text-xs text-blue-600">GHN88291042</span>
                        <span className="badge-risk text-[10px]">Còn 2h</span>
                      </div>
                      <div className="text-xs font-bold text-slate-900">Khách không nghe máy lần 1</div>
                      <div className="text-xs text-slate-500">COD: 350.000 đ · TP. Hồ Chí Minh</div>
                    </div>
                  </div>
                </div>
              )}

              {/* SCREEN 3: EXCEPTION WORKBOX */}
              {currentScreen === 3 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                    <button type="button" onClick={() => setCurrentScreen(2)} className="p-1 rounded-lg bg-white border border-slate-200">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="font-bold text-sm text-slate-900">Hộp Việc Ngoại Lệ (2)</span>
                  </div>

                  <div className="space-y-3">
                    <div
                      onClick={() => setCurrentScreen(5)}
                      className="p-4 bg-white rounded-2xl border-l-4 border-l-rose-600 border border-slate-200/80 shadow-xs space-y-2 cursor-pointer"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="font-mono font-bold text-xs text-blue-600 block">GHN88291042</span>
                          <span className="text-xs font-bold text-slate-900">Khách hẹn giao lại chiều</span>
                        </div>
                        <span className="badge-risk text-[10px]">SLA 2h</span>
                      </div>
                      <div className="flex justify-between items-center pt-2 border-t border-slate-100 text-xs text-slate-500">
                        <span>Khách: Nguyễn Văn Khách</span>
                        <button type="button" className="btn-primary text-[10px] py-1 px-2.5">Cứu đơn →</button>
                      </div>
                    </div>

                    <div
                      onClick={() => setCurrentScreen(5)}
                      className="p-4 bg-white rounded-2xl border-l-4 border-l-amber-500 border border-slate-200/80 shadow-xs space-y-2 cursor-pointer"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="font-mono font-bold text-xs text-blue-600 block">GHTK77129031</span>
                          <span className="text-xs font-bold text-slate-900">Sai địa chỉ ngõ</span>
                        </div>
                        <span className="badge-warn text-[10px]">SLA 4h</span>
                      </div>
                      <div className="flex justify-between items-center pt-2 border-t border-slate-100 text-xs text-slate-500">
                        <span>Khách: Trần Thị B</span>
                        <button type="button" className="btn-primary text-[10px] py-1 px-2.5">Cứu đơn →</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* SCREEN 4: TIMELINE */}
              {currentScreen === 4 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                    <button type="button" onClick={() => setCurrentScreen(3)} className="p-1 rounded-lg bg-white border border-slate-200">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <div>
                      <span className="font-mono font-bold text-xs text-slate-900 block">GHN88291042</span>
                      <span className="text-[10px] text-slate-400">Lịch sử hành trình hợp nhất</span>
                    </div>
                  </div>

                  <div className="space-y-3 pl-3 border-l-2 border-slate-200 ml-2 text-xs">
                    <div className="relative">
                      <div className="w-2.5 h-2.5 rounded-full bg-amber-500 absolute -left-[18px] top-1 ring-2 ring-white" />
                      <span className="font-bold text-slate-900 block">CSKH gọi xác nhận thành công</span>
                      <span className="text-[10px] text-slate-400 font-mono">17/08 09:30 · Trần Thị Hoa</span>
                    </div>
                    <div className="relative">
                      <div className="w-2.5 h-2.5 rounded-full bg-rose-500 absolute -left-[18px] top-1 ring-2 ring-white" />
                      <span className="font-bold text-rose-700 block">Giao thất bại lần 1 (Không nghe máy)</span>
                      <span className="text-[10px] text-slate-400 font-mono">17/08 08:15 · Shipper GHN</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setCurrentScreen(5)}
                    className="btn-primary w-full h-11 justify-center text-xs font-bold mt-4"
                  >
                    Gửi Yêu Cầu Giao Lại (L2 API) →
                  </button>
                </div>
              )}

              {/* SCREEN 5: REATTEMPT DISPATCH */}
              {currentScreen === 5 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                    <button type="button" onClick={() => setCurrentScreen(3)} className="p-1 rounded-lg bg-white border border-slate-200">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <div>
                      <span className="font-bold text-sm text-slate-900 block">Gửi Lệnh Giao Lại</span>
                      <span className="text-[10px] text-emerald-700 font-semibold">GHN L2 (Gọi API trực tiếp)</span>
                    </div>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">SĐT Người nhận:</label>
                      <input
                        type="tel"
                        value={phoneInput}
                        onChange={(e) => setPhoneInput(e.target.value)}
                        className="modern-input w-full font-mono text-xs h-10"
                      />
                    </div>
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Ngày hẹn giao lại:</label>
                      <input type="date" defaultValue="2026-08-18" className="modern-input w-full text-xs h-10" />
                    </div>
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Ghi chú cho Shipper:</label>
                      <textarea defaultValue="Khách hẹn giao sau 14h chiều" className="modern-input w-full text-xs h-16 resize-none" />
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        showMobileToast('✓ Đã gọi API GHN gửi lệnh giao lại thành công!');
                        setCurrentScreen(3);
                      }}
                      className="btn-primary w-full h-12 text-xs font-bold justify-center mt-2"
                    >
                      Bắn Lệnh Giao Lại Sang GHN (L2 API)
                    </button>
                  </div>
                </div>
              )}

              {/* SCREEN 6: RETURN SCAN (WAREHOUSE) */}
              {currentScreen === 6 && (
                <div className="space-y-3">
                  <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                    <span className="font-bold text-sm text-slate-900">Quét Nhận Hàng Hoàn</span>
                    <button
                      type="button"
                      onClick={() => setIsOffline(!isOffline)}
                      className="badge-warn text-[10px]"
                    >
                      {isOffline ? 'Offline Mode' : 'Online'}
                    </button>
                  </div>

                  <div className="space-y-3">
                    <input
                      type="text"
                      value={scannedCode}
                      onChange={(e) => setScannedCode(e.target.value)}
                      className="modern-input w-full font-mono text-sm font-bold uppercase h-11"
                      placeholder="Mã vạch bưu kiện..."
                    />

                    <select className="modern-input w-full text-xs h-10 font-semibold">
                      <option value="intact">1. Nguyên vẹn (Không hư)</option>
                      <option value="damaged">2. Hư hỏng (Bắt buộc chụp ảnh)</option>
                    </select>

                    <button
                      type="button"
                      onClick={() => {
                        setOfflineQueueCount((c) => c + 1);
                        showMobileToast(`✓ [BEEP!] Đã lưu mã ${scannedCode} vào SQLite.`);
                      }}
                      className="btn-primary w-full h-12 text-sm font-bold justify-center"
                    >
                      Xác Nhận Nhập Kho ({offlineQueueCount} chờ)
                    </button>
                  </div>
                </div>
              )}

              {/* SCREEN 7: COD & EXPIRING CLAIMS */}
              {currentScreen === 7 && (
                <div className="space-y-3">
                  <div className="border-b border-slate-200 pb-2">
                    <span className="font-bold text-sm text-slate-900 block">Đối Soát & Hạn Khiếu Nại</span>
                    <span className="text-[10px] text-slate-400">Giám sát thời hiệu BR-37</span>
                  </div>

                  <div className="p-4 bg-white rounded-2xl border border-slate-200/80 shadow-xs space-y-1">
                    <span className="text-[10px] text-slate-500 font-bold uppercase">COD ĐÃ ĐỐI SOÁT KỲ NÀY</span>
                    <div className="font-mono text-2xl font-bold text-emerald-700">
                      <Money amount={14200000} state="confirmed" />
                    </div>
                  </div>

                  <div className="p-4 bg-rose-50/70 border border-rose-200 rounded-2xl space-y-2">
                    <div className="flex justify-between items-center text-xs font-bold text-rose-800">
                      <span>Khiếu nại GHN88290500</span>
                      <span className="badge-risk text-[9px]">Còn 4h (!)</span>
                    </div>
                    <div className="text-xs text-slate-600">Yêu cầu bồi thường cước: 35.000 đ</div>
                    <button
                      type="button"
                      onClick={() => showMobileToast('✓ Đã nộp gói ZIP chứng cứ sang hãng')}
                      className="btn-primary w-full text-xs py-2 justify-center bg-rose-600 hover:bg-rose-700 border-rose-700 font-bold"
                    >
                      Nộp Chứng Cứ Ngay
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Mobile Navigation Bar */}
            <div className="bg-white border-t border-slate-200 py-2 px-3 grid grid-cols-4 gap-1 text-center text-[10px] font-semibold text-slate-500">
              <button type="button" onClick={() => setCurrentScreen(2)} className={`py-1.5 rounded-lg ${currentScreen === 2 ? 'bg-blue-50 text-blue-700 font-bold' : ''}`}>
                Trang chủ
              </button>
              <button type="button" onClick={() => setCurrentScreen(3)} className={`py-1.5 rounded-lg ${currentScreen === 3 ? 'bg-blue-50 text-blue-700 font-bold' : ''}`}>
                Hộp việc
              </button>
              <button type="button" onClick={() => setCurrentScreen(6)} className={`py-1.5 rounded-lg ${currentScreen === 6 ? 'bg-blue-50 text-blue-700 font-bold' : ''}`}>
                Quét kho
              </button>
              <button type="button" onClick={() => setCurrentScreen(7)} className={`py-1.5 rounded-lg ${currentScreen === 7 ? 'bg-blue-50 text-blue-700 font-bold' : ''}`}>
                COD & Hạn
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
