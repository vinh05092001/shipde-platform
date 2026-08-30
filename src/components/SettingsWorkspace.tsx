'use client';

import React, { useState } from 'react';
import {
  Store,
  Users,
  Key,
  Bell,
  Shield,
  Globe,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Copy,
  Check,
  Plus,
  Trash2,
  Lock,
  ArrowRight,
  ExternalLink,
  Smartphone,
  Radio,
  FileSpreadsheet,
} from 'lucide-react';
import { AutomationBadge, Money } from './ui/OperationalComponents';
import { PublicTrackingTab } from './PublicTrackingTab';
import { NotificationMatrixTab } from './NotificationMatrixTab';
import { UserManagementTab } from './UserManagementTab';

interface Props {
  onBackToDashboard: () => void;
  onToast: (msg: string) => void;
  carrierGhnTier?: 'L2' | 'L1';
  onToggleGhnTier?: (tier: 'L2' | 'L1') => void;
}

export const SettingsWorkspace: React.FC<Props> = ({
  onBackToDashboard,
  onToast,
  carrierGhnTier = 'L2',
  onToggleGhnTier,
}) => {
  const [activeSection, setActiveSection] = useState<
    'stores' | 'team' | 'integrations' | 'notifications' | 'security' | 'tracking_portal'
  >('stores');

  // Integrations State
  const [ghnTokenInput, setGhnTokenInput] = useState('');
  const [ghnShopId, setGhnShopId] = useState('189201');
  const [ghnClientId, setGhnClientId] = useState('554109');
  const [isEditingGhnToken, setIsEditingGhnToken] = useState(false);

  const [ghtkTokenInput, setGhtkTokenInput] = useState('');
  const [ghtkPartnerId, setGhtkPartnerId] = useState('PARTNER_ANAN_VN');
  const [isEditingGhtkToken, setIsEditingGhtkToken] = useState(false);

  const [pancakeApiKeyInput, setPancakeApiKeyInput] = useState('');
  const [pancakeShopId, setPancakeShopId] = useState('shop_anan_9901');
  const [isEditingPancakeKey, setIsEditingPancakeKey] = useState(false);

  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // Stores State
  const [stores, setStores] = useState([
    {
      id: 'store_01',
      name: 'Chi Nhánh Quận 3 (Trụ Sở Chính)',
      address: '128 Nguyễn Trãi, P. 3, Q. 5, TP. HCM',
      code: 'HCM-Q3',
      is_default: true,
    },
    {
      id: 'store_02',
      name: 'Kho Vận Tân Bình',
      address: '55 CMT8, P. 5, Tân Bình, TP. HCM',
      code: 'HCM-TB',
      is_default: false,
    },
    {
      id: 'store_03',
      name: 'Chi Nhánh Hà Nội',
      address: '320 Cầu Giấy, Quan Hoa, Cầu Giấy, Hà Nội',
      code: 'HN-CG',
      is_default: false,
    },
    {
      id: 'store_04',
      name: 'Chi Nhánh Đà Nẵng',
      address: '102 Hoàng Văn Thụ, Hải Châu, Đà Nẵng',
      code: 'DN-HC',
      is_default: false,
    },
  ]);

  // Device Sessions State
  const [sessions, setSessions] = useState([
    {
      id: 'sess_1',
      user: 'Nguyễn Văn An (Chủ Shop)',
      device: 'MacBook Pro · Chrome 127',
      ip: '14.161.22.88',
      location: 'TP. Hồ Chí Minh',
      last_active: 'Đang hoạt động',
      current: true,
    },
    {
      id: 'sess_2',
      user: 'Trần Thị Hoa (CSKH)',
      device: 'iPhone 15 Pro · iOS 17.5',
      ip: '113.190.44.12',
      location: 'TP. Hồ Chí Minh',
      last_active: '5 phút trước',
      current: false,
    },
    {
      id: 'sess_3',
      user: 'Phạm Văn Kho (Thủ kho)',
      device: 'Samsung Galaxy A54 · Android 14',
      ip: '115.79.33.90',
      location: 'TP. Hồ Chí Minh',
      last_active: '15 phút trước',
      current: false,
    },
  ]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedUrl(id);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const handleRevokeSession = (sessionId: string, userName: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    onToast(
      `✓ Đã thu hồi quyền truy cập thiết bị của ${userName}. Phiên làm việc đã bị vô hiệu hóa từ xa.`
    );
  };

  return (
    <div className="w-full space-y-6">
      {/* Settings Header */}
      <div className="modern-card p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-l-4 border-l-[#EA4B12]">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2.5">
            <Sliders className="w-6 h-6 text-[#EA4B12]" />
            <span>Cài Đặt & Cấu Hình Cửa Hàng</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Quản lý chi nhánh, nhân sự phân quyền, kết nối hãng vận chuyển và chính sách bảo mật hệ
            thống.
          </p>
        </div>

        <button type="button" onClick={onBackToDashboard} className="btn-secondary text-sm">
          <span>← Quay lại Bàn Điều Khiển</span>
        </button>
      </div>

      {/* Two-Column Layout: Secondary Sidebar + Content Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Secondary Navigation Sidebar (4 cols) */}
        <div className="lg:col-span-3 space-y-2">
          <nav className="modern-card p-2 space-y-1">
            {[
              {
                id: 'stores',
                label: 'Cửa Hàng & Chi Nhánh',
                icon: Store,
                desc: 'Phạm vi kho và chi nhánh',
              },
              {
                id: 'team',
                label: 'Nhân Sự & Phân Quyền',
                icon: Users,
                desc: 'Quản lý thành viên & RBAC',
              },
              {
                id: 'integrations',
                label: 'Tích Hợp Kênh & Hãng',
                icon: Key,
                desc: 'API GHN, GHTK, Pancake POS',
              },
              {
                id: 'notifications',
                label: 'Cấu Hình Cảnh Báo',
                icon: Bell,
                desc: 'Ma trận thông báo & PII',
              },
              {
                id: 'security',
                label: 'Bảo Mật & Phiên Thiết Bị',
                icon: Shield,
                desc: 'Giám sát IP & thu hồi từ xa',
              },
              {
                id: 'tracking_portal',
                label: 'Cổng Tra Cứu Khách Hàng',
                icon: Globe,
                desc: 'Trang công khai cho người mua',
              },
            ].map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveSection(item.id as any)}
                  className={`w-full text-left px-3.5 py-3 rounded-xl transition flex items-center gap-3 cursor-pointer ${
                    isActive
                      ? 'bg-[#FFF5F0] text-[#EA4B12] font-bold border border-[#FDDDD0]'
                      : 'text-slate-700 hover:bg-slate-50 font-medium'
                  }`}
                >
                  <Icon
                    className={`w-5 h-5 shrink-0 ${isActive ? 'text-[#EA4B12]' : 'text-slate-400'}`}
                  />
                  <div>
                    <div className="text-sm leading-tight">{item.label}</div>
                    <div className="text-xs text-slate-400 font-normal mt-0.5">{item.desc}</div>
                  </div>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Main Content Viewport (9 cols) */}
        <div className="lg:col-span-9">
          {/* SECTION 1: STORES & BRANCHES */}
          {activeSection === 'stores' && (
            <div className="modern-card p-6 space-y-6">
              <div className="flex justify-between items-center pb-4 border-b border-slate-100">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Danh Sách Chi Nhánh & Kho Vận
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Phân quyền vận đơn và kiểm soát bưu kiện theo từng địa điểm xuất hàng.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onToast('✓ Tính năng thêm chi nhánh mới')}
                  className="btn-primary text-xs"
                >
                  <Plus className="w-4 h-4" />
                  <span>Thêm Chi Nhánh</span>
                </button>
              </div>

              <div className="divide-y divide-slate-100">
                {stores.map((store) => (
                  <div key={store.id} className="py-4 flex items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-900">{store.name}</span>
                        <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold border border-slate-200">
                          {store.code}
                        </span>
                        {store.is_default && <span className="badge-ok text-xs">Mặc Định</span>}
                      </div>
                      <p className="text-xs text-slate-500">{store.address}</p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onToast(`✓ Đang chỉnh sửa thông tin ${store.name}`)}
                        className="btn-secondary text-xs"
                      >
                        Chỉnh Sửa
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SECTION 2: TEAM & PERMISSIONS */}
          {activeSection === 'team' && (
            <div className="space-y-4">
              <UserManagementTab />
            </div>
          )}

          {/* SECTION 3: INTEGRATIONS (CARRIERS & POS) */}
          {activeSection === 'integrations' && (
            <div className="space-y-6">
              {/* R1 Active Integrations */}
              <div className="modern-card p-6 space-y-6">
                <div className="pb-4 border-b border-slate-100">
                  <h2 className="text-base font-bold text-slate-900">
                    1. Kênh Bán Hàng & Cổng Hãng Đang Kết Nối (R1 Core)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Khai báo thông tin API và Webhook tiếp nhận sự kiện từ các đối tác chính thức.
                  </p>
                </div>

                {/* GHN Card */}
                <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-4">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center font-black text-xs text-[#EA4B12] shadow-2xs">
                        GHN
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-sm text-slate-900">
                            Giao Hàng Nhanh (GHN Express)
                          </h3>
                          <span className="badge-ok text-xs">Đang Hoạt Động</span>
                        </div>
                        <p className="text-xs text-slate-500">
                          Đồng bộ trạng thái toàn trình qua Webhook & gọi lệnh giao lại tự động.
                        </p>
                      </div>
                    </div>

                    <AutomationBadge tier={carrierGhnTier} carrierCode="GHN" />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                    {/* API Token (Write-Only Secret) */}
                    <div>
                      <label className="text-xs font-bold text-slate-700 block mb-1">
                        API Token (Khóa Bí Mật):
                      </label>
                      {isEditingGhnToken ? (
                        <div className="flex gap-2">
                          <input
                            type="password"
                            value={ghnTokenInput}
                            onChange={(e) => setGhnTokenInput(e.target.value)}
                            placeholder="Dán mã token mới từ cổng GHN..."
                            className="modern-input text-xs"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setIsEditingGhnToken(false);
                              onToast('✓ Đã cập nhật API Token GHN thành công.');
                            }}
                            className="btn-primary text-xs"
                          >
                            Lưu
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200 text-xs">
                          <span className="font-mono text-slate-600 font-semibold">
                            ghn_live_••••••••••••9842
                          </span>
                          <button
                            type="button"
                            onClick={() => setIsEditingGhnToken(true)}
                            className="text-xs font-bold text-[#EA4B12] hover:underline"
                          >
                            Đổi Token
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Shop ID */}
                    <div>
                      <label className="text-xs font-bold text-slate-700 block mb-1">
                        GHN Shop ID & Client ID:
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={ghnShopId}
                          onChange={(e) => setGhnShopId(e.target.value)}
                          className="modern-input text-xs font-mono"
                          placeholder="Shop ID"
                        />
                        <input
                          type="text"
                          value={ghnClientId}
                          onChange={(e) => setGhnClientId(e.target.value)}
                          className="modern-input text-xs font-mono"
                          placeholder="Client ID"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Webhook Endpoint */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700 block">
                      Webhook Endpoint Nhận Sự Kiện GHN:
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        readOnly
                        value="https://api.shipde.net/v1/webhooks/ghn/wh_anan_9901"
                        className="modern-input text-xs font-mono bg-white text-slate-600 select-all"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard(
                            'https://api.shipde.net/v1/webhooks/ghn/wh_anan_9901',
                            'ghn'
                          )
                        }
                        className="btn-secondary text-xs"
                        title="Sao chép URL"
                      >
                        {copiedUrl === 'ghn' ? (
                          <Check className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                        <span>{copiedUrl === 'ghn' ? 'Đã chép' : 'Sao chép'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Action Buttons: Test Connection separated from Save */}
                  <div className="flex justify-between items-center pt-3 border-t border-slate-200">
                    <button
                      type="button"
                      onClick={() =>
                        onToggleGhnTier && onToggleGhnTier(carrierGhnTier === 'L2' ? 'L1' : 'L2')
                      }
                      className="text-xs font-bold text-slate-600 hover:text-slate-900 underline"
                    >
                      Chuyển sang{' '}
                      {carrierGhnTier === 'L2' ? 'Chế độ Hỗ trợ (L1)' : 'Tự động gọi API (L2)'}
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          onToast('✓ [GHN Express] Kiểm tra kết nối API thành công (Độ trễ: 38ms).')
                        }
                        className="btn-secondary text-xs"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Kiểm Tra Kết Nối</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onToast('✓ Đã lưu cấu hình GHN thành công.')}
                        className="btn-primary text-xs"
                      >
                        Lưu Cấu Hình
                      </button>
                    </div>
                  </div>
                </div>

                {/* GHTK Card */}
                <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-4">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center font-black text-xs text-emerald-700 shadow-2xs">
                        GHTK
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-sm text-slate-900">
                            Giao Hàng Tiết Kiệm (GHTK)
                          </h3>
                          <span className="badge-ok text-xs">Đang Hoạt Động</span>
                        </div>
                        <p className="text-xs text-slate-500">
                          Tự động tổng hợp hồ sơ chuẩn mẫu dán cổng khi cần can thiệp giao lại.
                        </p>
                      </div>
                    </div>

                    <AutomationBadge tier="L1" carrierCode="GHTK" />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                    <div>
                      <label className="text-xs font-bold text-slate-700 block mb-1">
                        Partner Token:
                      </label>
                      {isEditingGhtkToken ? (
                        <div className="flex gap-2">
                          <input
                            type="password"
                            value={ghtkTokenInput}
                            onChange={(e) => setGhtkTokenInput(e.target.value)}
                            placeholder="Dán token GHTK..."
                            className="modern-input text-xs"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setIsEditingGhtkToken(false);
                              onToast('✓ Đã cập nhật Token GHTK.');
                            }}
                            className="btn-primary text-xs"
                          >
                            Lưu
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200 text-xs">
                          <span className="font-mono text-slate-600 font-semibold">
                            ghtk_partner_••••••••2394
                          </span>
                          <button
                            type="button"
                            onClick={() => setIsEditingGhtkToken(true)}
                            className="text-xs font-bold text-[#EA4B12] hover:underline"
                          >
                            Đổi Token
                          </button>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="text-xs font-bold text-slate-700 block mb-1">
                        Partner ID:
                      </label>
                      <input
                        type="text"
                        value={ghtkPartnerId}
                        onChange={(e) => setGhtkPartnerId(e.target.value)}
                        className="modern-input text-xs font-mono"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end items-center gap-2 pt-3 border-t border-slate-200">
                    <button
                      type="button"
                      onClick={() =>
                        onToast('✓ [GHTK] Kiểm tra cổng đối tác thành công (Ping: 45ms).')
                      }
                      className="btn-secondary text-xs"
                    >
                      Kiểm Tra Kết Nối
                    </button>
                    <button
                      type="button"
                      onClick={() => onToast('✓ Đã lưu cấu hình GHTK.')}
                      className="btn-primary text-xs"
                    >
                      Lưu Cấu Hình
                    </button>
                  </div>
                </div>

                {/* Pancake POS Card */}
                <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center font-black text-xs text-blue-600 shadow-2xs">
                        POS
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-sm text-slate-900">Pancake POS Open API</h3>
                          <span className="badge-ok text-xs">Tự Động Đồng Bộ</span>
                        </div>
                        <p className="text-xs text-slate-500">
                          Tự động nạp đơn hàng mới, thông tin khách và mã vận đơn vào Ship Dễ.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                    <div>
                      <label className="text-xs font-bold text-slate-700 block mb-1">
                        Pancake API Key:
                      </label>
                      <div className="flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200 text-xs">
                        <span className="font-mono text-slate-600 font-semibold">
                          pk_live_••••••••1039
                        </span>
                        <button
                          type="button"
                          onClick={() => onToast('✓ Vui lòng nhập mã API Key mới')}
                          className="text-xs font-bold text-[#EA4B12] hover:underline"
                        >
                          Cập Nhật
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-bold text-slate-700 block mb-1">
                        Shop ID:
                      </label>
                      <input
                        type="text"
                        value={pancakeShopId}
                        onChange={(e) => setPancakeShopId(e.target.value)}
                        className="modern-input text-xs font-mono"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Roadmap Deferred Integrations (R2/R3) */}
              <div className="modern-card p-6 space-y-4">
                <div className="pb-3 border-b border-slate-100">
                  <h2 className="text-base font-bold text-slate-900">
                    2. Cổng Tích Hợp Đang Phát Triển (Lộ Trình R2 / R3)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Các cổng sau được lên kế hoạch phát hành ở phiên bản tiếp theo.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {[
                    { name: 'Viettel Post', type: 'Hãng vận chuyển', badge: 'Lộ trình R2' },
                    { name: 'J&T Express', type: 'Hãng vận chuyển', badge: 'Lộ trình R2' },
                    { name: 'VNPost', type: 'Hãng vận chuyển', badge: 'Lộ trình R2' },
                    { name: 'KiotViet POS', type: 'Kênh bán lẻ', badge: 'Lộ trình R2' },
                    { name: 'TikTok Shop', type: 'Sàn TMĐT', badge: 'Lộ trình R2' },
                    {
                      name: 'Public Developer API',
                      type: 'Cổng lập trình viên',
                      badge: 'Lộ trình R3',
                    },
                  ].map((ch, idx) => (
                    <div
                      key={idx}
                      className="p-4 rounded-xl border border-slate-200 bg-white space-y-2 opacity-75"
                    >
                      <div className="flex justify-between items-start">
                        <span className="font-bold text-sm text-slate-900">{ch.name}</span>
                        <span className="badge-warn text-[11px]">{ch.badge}</span>
                      </div>
                      <p className="text-xs text-slate-500">{ch.type} · Sắp ra mắt</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* SECTION 4: NOTIFICATIONS & ALERTS */}
          {activeSection === 'notifications' && (
            <div className="space-y-4">
              <NotificationMatrixTab />
            </div>
          )}

          {/* SECTION 5: SECURITY & DEVICE SESSIONS */}
          {activeSection === 'security' && (
            <div className="modern-card p-6 space-y-6">
              <div className="pb-4 border-b border-slate-100">
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Shield className="w-5 h-5 text-emerald-600" />
                  <span>Giám Sát Bảo Mật & Phiên Làm Việc Thiết Bị</span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Kiểm soát các thiết bị di động, máy tính của nhân viên đang đăng nhập vào hệ thống
                  và thu hồi quyền từ xa khi cần.
                </p>
              </div>

              <div className="divide-y divide-slate-100">
                {sessions.map((sess) => (
                  <div
                    key={sess.id}
                    className="py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-900">{sess.user}</span>
                        {sess.current ? (
                          <span className="badge-ok text-xs">Phiên Này</span>
                        ) : (
                          <span className="text-xs text-slate-500 font-medium">
                            · {sess.last_active}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 flex items-center gap-3">
                        <span className="flex items-center gap-1">
                          <Smartphone className="w-3.5 h-3.5 text-slate-400" />
                          <span>{sess.device}</span>
                        </span>
                        <span className="font-mono text-slate-400">IP: {sess.ip}</span>
                        <span>{sess.location}</span>
                      </div>
                    </div>

                    {!sess.current && (
                      <button
                        type="button"
                        onClick={() => handleRevokeSession(sess.id, sess.user)}
                        className="btn-danger text-xs py-1.5 px-3"
                      >
                        Thu Hồi Quyền
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SECTION 6: PUBLIC TRACKING PORTAL PREVIEW */}
          {activeSection === 'tracking_portal' && (
            <div className="space-y-4">
              <PublicTrackingTab />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
