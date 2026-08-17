'use client';

import React, { useState } from 'react';
import { X, Store, Truck, DollarSign, Users, Bell, Search, ShieldCheck, CheckCircle2, AlertTriangle, Key, ExternalLink } from 'lucide-react';
import { ApiIntegrationsTab } from './ApiIntegrationsTab';
import { UserManagementTab } from './UserManagementTab';
import { NotificationMatrixTab } from './NotificationMatrixTab';
import { PublicTrackingTab } from './PublicTrackingTab';

interface ShopSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: string;
  onToast: (msg: string) => void;
}

export const ShopSettingsModal: React.FC<ShopSettingsModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'pos_carrier',
  onToast,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<string>(initialTab);

  if (!isOpen) return null;

  const SETTINGS_SECTIONS = [
    { id: 'pos_carrier', label: 'Kênh Bán Hàng & Hãng (CN-01, CN-04)', icon: Truck },
    { id: 'users_rbac', label: 'Nhân Viên & Phân Quyền (CN-24, BR-12)', icon: Users },
    { id: 'notifications', label: 'Cấu Hình Cảnh Báo (CN-19, BR-23)', icon: Bell },
    { id: 'public_portal', label: 'Cổng Tra Cứu Khách Hàng (CN-20)', icon: Search },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white w-full max-w-6xl max-h-[90vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
              <Store className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Cài Đặt Cửa Hàng & Vận Hành (Shop Settings)</h2>
              <p className="text-xs text-slate-500">Cấu hình kết nối Pancake POS, tài khoản hãng GHN/GHTK, biểu giá hợp đồng và phân quyền nhân sự</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body: Sidebar + Main Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sub Navigation Sidebar */}
          <div className="w-64 border-r border-slate-200 bg-slate-50 p-3 space-y-1 overflow-y-auto">
            <div className="px-3 py-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Phân Hệ Cấu Hình:
            </div>
            {SETTINGS_SECTIONS.map((sec) => {
              const Icon = sec.icon;
              const isActive = activeSubTab === sec.id;
              return (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => setActiveSubTab(sec.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2.5 cursor-pointer ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-700 hover:bg-slate-200/70 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{sec.label}</span>
                </button>
              );
            })}
          </div>

          {/* Sub Content Viewport */}
          <div className="flex-1 p-6 overflow-y-auto bg-white custom-scrollbar">
            {activeSubTab === 'pos_carrier' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 mb-1">Kết Nối Nguồn Đơn & Tài Khoản Hãng (R1)</h3>
                  <p className="text-xs text-slate-500 mb-4">Quản lý kết nối Pancake POS (CN-01) và tài khoản hãng chính thức GHN (L2 API) & GHTK (L1 Assist) (CN-04, BR-15)</p>
                </div>
                <ApiIntegrationsTab />
              </div>
            )}

            {activeSubTab === 'users_rbac' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 mb-1">Quản Lý Nhân Viên & Phân Quyền Chi Nhánh (CN-24)</h3>
                  <p className="text-xs text-slate-500 mb-4">Phân quyền 4 vai trò (Chủ shop, CSKH, Kế toán, Kho), gán phạm vi chi nhánh và thực thi quy tắc Maker-Checker (BR-12)</p>
                </div>
                <UserManagementTab />
              </div>
            )}

            {activeSubTab === 'notifications' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 mb-1">Ma Trận Cấu Hình Cảnh Báo (CN-19, BR-23)</h3>
                  <p className="text-xs text-slate-500 mb-4">Cấu hình thông báo cho ngoại lệ bưu kiện, COD quá hạn và thời hiệu khiếu nại 48h kèm cơ chế chống dội tin</p>
                </div>
                <NotificationMatrixTab />
              </div>
            )}

            {activeSubTab === 'public_portal' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 mb-1">Cổng Tra Cứu Toàn Trình Cho Người Nhận (CN-20, BR-42)</h3>
                  <p className="text-xs text-slate-500 mb-4">Cung cấp đường link tra cứu hành trình không cần đăng nhập cho người mua, bảo vệ thông tin cá nhân tối thiểu</p>
                </div>
                <PublicTrackingTab />
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <span className="text-xs text-slate-500 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Mọi thay đổi cấu hình được lưu vết nhật ký kiểm toán bất biến (BR-21)</span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg transition cursor-pointer"
          >
            Đóng Cài Đặt
          </button>
        </div>
      </div>
    </div>
  );
};
