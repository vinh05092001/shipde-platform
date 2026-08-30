'use client';

import React, { useState } from 'react';
import { Bell, Sliders, Check, Send, ShieldCheck } from 'lucide-react';

export const NotificationMatrixTab: React.FC = () => {
  const [digestWindow, setDigestWindow] = useState('15');
  const [toast, setToast] = useState<string | null>(null);

  const [matrix, setMatrix] = useState([
    {
      event: 'Giao hàng thất bại (Delivery Fail)',
      ownerPush: true,
      opsPush: true,
      accountantPush: false,
      email: false,
      urgent: true,
    },
    {
      event: 'Phát hiện lệch cước > 50.000 đ',
      ownerPush: false,
      opsPush: false,
      accountantPush: true,
      email: true,
      urgent: false,
    },
    {
      event: 'COD quá hạn thanh toán theo SLA',
      ownerPush: true,
      opsPush: false,
      accountantPush: true,
      email: true,
      urgent: true,
    },
    {
      event: 'Hồ sơ khiếu nại còn < 48h tới hạn',
      ownerPush: true,
      opsPush: true,
      accountantPush: true,
      email: true,
      urgent: true,
    },
    {
      event: 'Kiện hàng hoàn về kho bất thường (hư/thiếu)',
      ownerPush: false,
      opsPush: true,
      accountantPush: false,
      email: false,
      urgent: false,
    },
  ]);

  const toggleCheck = (idx: number, field: string) => {
    setMatrix((prev) =>
      prev.map((item, i) =>
        i === idx ? { ...item, [field]: !item[field as keyof typeof item] } : item
      )
    );
  };

  const handleSave = () => {
    setToast(
      `✓ Đã lưu cấu hình ma trận thông báo & ngưỡng gộp tin ${digestWindow} phút thành công (CN-19, BR-23).`
    );
    setTimeout(() => setToast(null), 4000);
  };

  const handleTestNotification = () => {
    setToast(
      '✓ Đã gửi thông báo thử nghiệm mẫu tới thiết bị đã liên kết qua FCM/APNS (BR-42 Masked).'
    );
    setTimeout(() => setToast(null), 4000);
  };

  return (
    <div className="w-full space-y-6">
      {toast && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs font-semibold flex items-center justify-between shadow-sm animate-in fade-in">
          <span>{toast}</span>
          <button type="button" onClick={() => setToast(null)} className="font-bold">
            ✕
          </button>
        </div>
      )}

      {/* Header Bar */}
      <div className="modern-card p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Bell className="w-5 h-5 text-blue-600" />
              Ma Trận Cấu Hình Thông Báo & Chống Dội Tin (CN-19 · BR-23)
            </h2>
            <span className="badge-ok text-xs">FCM / APNS Multi-channel</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Cấu hình phân phối thông báo đa kênh theo vai trò và kích hoạt cơ chế gộp tin chống dội
            chuông liên tục
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={handleTestNotification} className="btn-secondary text-xs">
            <Send className="w-3.5 h-3.5" />
            <span>Bắn Test Thử</span>
          </button>
          <button type="button" onClick={handleSave} className="btn-primary text-xs">
            <Check className="w-3.5 h-3.5" />
            <span>Lưu Cấu Hình</span>
          </button>
        </div>
      </div>

      {/* Digest Window Setting Card */}
      <div className="modern-card p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="space-y-1">
          <span className="font-bold text-sm text-slate-900 flex items-center gap-2">
            <Sliders className="w-4 h-4 text-blue-600" />
            Cửa Sổ Gộp Tin Chống Dội Chuông (BR-23):
          </span>
          <p className="text-xs text-slate-500">
            Tự động gộp các thông báo không khẩn thành 1 bản tin tóm tắt trong khung giờ cao điểm để
            tránh làm phiền nhân viên.
          </p>
        </div>

        <select
          value={digestWindow}
          onChange={(e) => setDigestWindow(e.target.value)}
          className="modern-input text-xs font-semibold w-60"
        >
          <option value="0">Gửi ngay tức thì (Không gộp)</option>
          <option value="15">Gộp định kỳ 15 phút (Khuyên dùng)</option>
          <option value="30">Gộp định kỳ 30 phút</option>
          <option value="60">Gộp định kỳ 1 giờ</option>
        </select>
      </div>

      {/* Matrix Table */}
      <div className="modern-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="modern-table">
            <thead>
              <tr>
                <th>Sự Kiện Nghiệp Vụ</th>
                <th className="text-center" style={{ width: '130px' }}>
                  App Chủ Shop
                </th>
                <th className="text-center" style={{ width: '130px' }}>
                  App CSKH
                </th>
                <th className="text-center" style={{ width: '130px' }}>
                  App Kế Toán
                </th>
                <th className="text-center" style={{ width: '130px' }}>
                  Email Báo Cáo
                </th>
                <th className="text-center" style={{ width: '130px' }}>
                  Mức Khẩn Cấp
                </th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((row, idx) => (
                <tr key={idx}>
                  <td className="font-semibold text-slate-800 text-xs">{row.event}</td>
                  <td className="text-center">
                    <input
                      type="checkbox"
                      checked={row.ownerPush}
                      onChange={() => toggleCheck(idx, 'ownerPush')}
                      className="w-4 h-4 rounded text-blue-600 cursor-pointer"
                    />
                  </td>
                  <td className="text-center">
                    <input
                      type="checkbox"
                      checked={row.opsPush}
                      onChange={() => toggleCheck(idx, 'opsPush')}
                      className="w-4 h-4 rounded text-blue-600 cursor-pointer"
                    />
                  </td>
                  <td className="text-center">
                    <input
                      type="checkbox"
                      checked={row.accountantPush}
                      onChange={() => toggleCheck(idx, 'accountantPush')}
                      className="w-4 h-4 rounded text-blue-600 cursor-pointer"
                    />
                  </td>
                  <td className="text-center">
                    <input
                      type="checkbox"
                      checked={row.email}
                      onChange={() => toggleCheck(idx, 'email')}
                      className="w-4 h-4 rounded text-blue-600 cursor-pointer"
                    />
                  </td>
                  <td className="text-center">
                    <span
                      className={row.urgent ? 'badge-risk text-[10px]' : 'badge-muted text-[10px]'}
                    >
                      {row.urgent ? 'Khẩn (Gửi ngay)' : 'Thường'}
                    </span>
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
