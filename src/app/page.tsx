'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { LoginView } from '@/components/auth/LoginView';
import { RegisterView } from '@/components/auth/RegisterView';
import { ActiveRole, UIExceptionItem, UIDiscrepancyItem, UIClaimItem } from '@/components/types';
import { INITIAL_EXCEPTIONS, INITIAL_DISCREPANCIES, INITIAL_CLAIMS } from '@/components/mock-data';

import { ShipmentListTab } from '@/components/ShipmentListTab';
import { ControlTowerTab } from '@/components/ControlTowerTab';
import { ThreeLedgersTab } from '@/components/ThreeLedgersTab';
import { ExceptionWorkboxTab } from '@/components/ExceptionWorkboxTab';
import { ReconciliationTab } from '@/components/ReconciliationTab';
import { ReturnScanTab } from '@/components/ReturnScanTab';
import { ClaimCasesTab } from '@/components/ClaimCasesTab';
import { AdminSystemTab } from '@/components/AdminSystemTab';
import { ShopSettingsModal } from '@/components/ShopSettingsModal';
import { UnifiedTrackingModal } from '@/components/UnifiedTrackingModal';
import { UploadStatementModal } from '@/components/UploadStatementModal';
import { ApiIntegrationsTab } from '@/components/ApiIntegrationsTab';

import {
  Package,
  LayoutDashboard,
  TrendingUp,
  AlertTriangle,
  DollarSign,
  RotateCcw,
  FileText,
  Database,
  Search,
  Settings,
  RefreshCw,
  LogOut,
  ChevronDown,
  ShieldCheck,
  Store,
  CheckCircle2,
  Lock,
  Key,
  Webhook,
} from 'lucide-react';

export default function ShipDeConsoleApp() {
  const { user, merchant, isAuthenticated, logout, switchRole } = useAuth();
  const [authMode, setAuthMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN');

  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [carrierGhnTier, setCarrierGhnTier] = useState<'L2' | 'L1'>('L2');

  const [exceptions, setExceptions] = useState<UIExceptionItem[]>(INITIAL_EXCEPTIONS);
  const [discrepancies, setDiscrepancies] = useState<UIDiscrepancyItem[]>(INITIAL_DISCREPANCIES);
  const [claims, setClaims] = useState<UIClaimItem[]>(INITIAL_CLAIMS);

  // Modals
  const [shopSettingsOpen, setShopSettingsOpen] = useState(false);
  const [uploadStatementOpen, setUploadStatementOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchCode, setGlobalSearchCode] = useState('');
  const [selectedGlobalTracking, setSelectedGlobalTracking] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [syncingPancake, setSyncingPancake] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [selectedStore, setSelectedStore] = useState<string>('ALL');
  const [storeMenuOpen, setStoreMenuOpen] = useState(false);

  const STORES_LIST = [
    { id: 'ALL', name: 'Toàn Hệ Thống (Tất cả 4 chi nhánh)', code: 'ALL' },
    { id: 'store_01', name: 'Chi Nhánh Quận 3 (Trụ Sở Chính)', code: 'HCM-Q3' },
    { id: 'store_02', name: 'Kho Vận Tân Bình', code: 'HCM-TB' },
    { id: 'store_03', name: 'Chi Nhánh Hà Nội (Cầu Giấy)', code: 'HN-CG' },
    { id: 'store_04', name: 'Chi Nhánh Đà Nẵng (Hải Châu)', code: 'DN-HC' },
  ];

  const currentStoreObj = STORES_LIST.find(s => s.id === selectedStore) || STORES_LIST[0];

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleUpdateException = (updated: UIExceptionItem) => {
    setExceptions((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
  };

  const handleUpdateDiscrepancy = (updated: UIDiscrepancyItem) => {
    setDiscrepancies((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
  };

  const handleUpdateClaim = (updated: UIClaimItem) => {
    setClaims((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
  };

  const handleGlobalSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!globalSearchCode.trim()) return;
    setSelectedGlobalTracking(globalSearchCode.trim().toUpperCase());
    setGlobalSearchOpen(false);
    setGlobalSearchCode('');
  };

  const handleSyncPancake = async () => {
    setSyncingPancake(true);
    try {
      const res = await fetch('/api/shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'SYNC_PANCAKE' }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('✓ Đã đồng bộ đơn hàng mới từ Pancake POS Open API thành công.');
      } else {
        showToast(`Lỗi: ${data.error?.message || 'Không thể đồng bộ'}`);
      }
    } catch (e: any) {
      showToast(`Lỗi kết nối: ${e.message}`);
    } finally {
      setSyncingPancake(false);
    }
  };

  // Keyboard shortcut ⌘K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setGlobalSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const currentRole = user?.role || 'OWNER';

  const openExcCount = exceptions.filter((e) => e.status === 'OPEN').length;
  const openDiscCount = discrepancies.filter((d) => String(d.status).toUpperCase() === 'OPEN').length;
  const urgentClaimCount = claims.filter((c) => c.status !== 'CLOSED').length;

  // Role-based Tab Definition (Max 4-5 tabs per role)
  const getTabsForRole = (role: string) => {
    switch (role) {
      case 'OPS_CSKH':
        return [
          { id: 'dashboard', label: 'Tổng Quan CSKH', icon: LayoutDashboard },
          { id: 'exceptions', label: 'Hộp Việc Cứu Đơn', icon: AlertTriangle, count: openExcCount, countType: 'risk' },
          { id: 'shipments', label: 'Tra Cứu Vận Đơn', icon: Package },
          { id: 'claims', label: 'Khiếu Nại Giao Hàng', icon: FileText, count: urgentClaimCount, countType: 'warn' },
        ];
      case 'ACCOUNTANT':
        return [
          { id: 'dashboard', label: 'Tổng Quan Đối Soát', icon: LayoutDashboard },
          { id: 'reconciliation', label: 'Đối Soát COD & Cước', icon: DollarSign, count: openDiscCount, countType: 'risk' },
          { id: 'shipments', label: 'Tra Cứu Vận Đơn', icon: Package },
          { id: 'three_ledgers', label: 'Báo Cáo Ba Sổ', icon: TrendingUp },
          { id: 'claims', label: 'Theo Dõi Bồi Thường', icon: FileText, count: urgentClaimCount, countType: 'warn' },
        ];
      case 'WAREHOUSE':
        return [
          { id: 'returns', label: 'Tiếp Nhận Hàng Hoàn', icon: RotateCcw },
          { id: 'shipments', label: 'Tra Cứu Vận Đơn Kho', icon: Package },
          { id: 'claims', label: 'Báo Cáo Hàng Hư Hỏng', icon: FileText },
        ];
      case 'BACKOFFICE':
        return [
          { id: 'api_integrations', label: 'Khai Báo API, Webhooks & Cổng Hãng (CN-01, CN-04, CN-21)', icon: Key },
          { id: 'admin_matrix', label: 'Ma Trận Năng Lực Hãng L0/L1/L2 (CN-05)', icon: Settings },
          { id: 'admin_unmapped', label: 'Hàng Chờ Trạng Thái Chưa Ánh Xạ (CN-23)', icon: Database },
        ];
      case 'OWNER':
      default:
        return [
          { id: 'dashboard', label: 'Bàn Điều Khiển & 3 Sổ', icon: LayoutDashboard },
          { id: 'shipments', label: 'Quản Lý Vận Đơn', icon: Package },
          { id: 'exceptions', label: 'Hộp Việc Cứu Đơn', icon: AlertTriangle, count: openExcCount, countType: 'risk' },
          { id: 'reconciliation', label: 'Đối Soát COD & Cước', icon: DollarSign, count: openDiscCount, countType: 'risk' },
          { id: 'api_integrations', label: 'Khai Báo API & Webhooks', icon: Key },
          { id: 'returns', label: 'Quản Lý Nhập Hoàn', icon: RotateCcw },
        ];
    }
  };

  const currentTabs = getTabsForRole(currentRole);

  const handleRoleChange = (newRole: any) => {
    switchRole(newRole);
    setUserMenuOpen(false);
    const newTabs = getTabsForRole(newRole);
    if (!newTabs.some(t => t.id === activeTab)) {
      setActiveTab(newTabs[0].id);
    }
    showToast(`Đã chuyển vai trò: ${newRole}`);
  };

  if (!isAuthenticated) {
    if (authMode === 'REGISTER') {
      return <RegisterView onSwitchToLogin={() => setAuthMode('LOGIN')} />;
    }
    return <LoginView onSwitchToRegister={() => setAuthMode('REGISTER')} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-between font-sans selection:bg-blue-600 selection:text-white">
      <div>
        {/* Global Modern Toast */}
        {toastMessage && (
          <div className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-xl border border-slate-700 text-xs font-semibold flex items-center gap-2.5 animate-in slide-in-from-bottom-2 duration-150">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>{toastMessage}</span>
            <button onClick={() => setToastMessage(null)} className="text-slate-400 hover:text-white font-bold ml-2">✕</button>
          </div>
        )}

        {/* Top Header */}
        <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-xs">
          <div className="max-w-[1600px] mx-auto px-4 sm:px-6 h-15 flex items-center justify-between gap-4">
            {/* Logo & Store Selector */}
            <div className="flex items-center gap-3.5">
              <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-black text-sm shadow-xs">
                S
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900 text-sm tracking-tight">Ship Dễ</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 font-bold border border-slate-200">
                  R1 Control
                </span>

                {/* Branch / Store Selector */}
                <div className="relative ml-1">
                  <button
                    type="button"
                    onClick={() => setStoreMenuOpen(!storeMenuOpen)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200/80 px-2.5 py-1 rounded-lg border border-slate-200 transition cursor-pointer"
                  >
                    <Store className="w-3.5 h-3.5 text-blue-600" />
                    <span className="truncate max-w-[140px]">{currentStoreObj.name}</span>
                    <ChevronDown className="w-3 h-3 text-slate-400" />
                  </button>

                  {storeMenuOpen && (
                    <div className="absolute left-0 mt-1.5 w-72 bg-white rounded-xl shadow-xl border border-slate-200 p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 text-xs">
                      <div className="px-2 py-1.5 border-b border-slate-100 font-bold text-[10px] text-slate-400 uppercase tracking-wider">
                        Phạm Vi Chi Nhánh / Kho (CN-24):
                      </div>
                      {STORES_LIST.map((store) => (
                        <button
                          key={store.id}
                          type="button"
                          onClick={() => {
                            setSelectedStore(store.id);
                            setStoreMenuOpen(false);
                            showToast(`Đã chuyển phạm vi: ${store.name}`);
                          }}
                          className={`w-full text-left px-2.5 py-2 rounded-lg transition flex items-center justify-between ${
                            selectedStore === store.id
                              ? 'bg-blue-50 text-blue-700 font-bold'
                              : 'hover:bg-slate-100 text-slate-700'
                          }`}
                        >
                          <span className="truncate">{store.name}</span>
                          <span className="font-mono text-[10px] text-slate-400">{store.code}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Top Operational Status & Actions */}
            <div className="flex items-center gap-2">
              {/* POS Status Badge */}
              <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-semibold">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Pancake POS: Đang Đồng Bộ (CN-01)</span>
              </div>

              {/* Quick Search Shortcut ⌘K */}
              <button
                type="button"
                onClick={() => setGlobalSearchOpen(true)}
                className="hidden sm:flex items-center gap-2 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200/80 border border-slate-200 px-3 py-1.5 rounded-lg transition"
              >
                <Search className="w-3.5 h-3.5 text-slate-400" />
                <span>Tìm mã</span>
                <kbd className="font-mono text-[10px] bg-white text-slate-600 px-1.5 py-0.5 rounded border border-slate-200 shadow-2xs">
                  ⌘K
                </kbd>
              </button>

              {/* Manual POS Sync Trigger */}
              <button
                type="button"
                onClick={handleSyncPancake}
                disabled={syncingPancake}
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg transition cursor-pointer"
                title="Kích hoạt đồng bộ đơn hàng mới từ Pancake POS Open API (CN-01)"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncingPancake ? 'animate-spin text-blue-600' : 'text-slate-600'}`} />
                <span>Đồng bộ</span>
              </button>

              {/* Shop Settings (Owner Only) */}
              {currentRole === 'OWNER' && (
                <button
                  type="button"
                  onClick={() => setShopSettingsOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200/90 border border-slate-200 rounded-lg transition cursor-pointer"
                  title="Cài đặt kết nối POS, tài khoản hãng, biểu giá hợp đồng và phân quyền"
                >
                  <Settings className="w-3.5 h-3.5 text-slate-600" />
                  <span>Cài Đặt Shop</span>
                </button>
              )}

              {/* User Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200/80 px-2.5 py-1.5 rounded-lg border border-slate-200 transition text-xs font-semibold"
                >
                  <div className="w-6 h-6 rounded-md bg-blue-600 text-white flex items-center justify-center text-[11px] font-bold">
                    {user?.full_name?.charAt(0) || 'U'}
                  </div>
                  <div className="hidden md:block text-left pr-1">
                    <div className="text-[12px] text-slate-900 leading-tight truncate max-w-[120px]">
                      {user?.full_name}
                    </div>
                    <div className="text-[10px] text-blue-600 font-mono leading-none">
                      {user?.role}
                    </div>
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                </button>

                {userMenuOpen && (
                  <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-200 p-2 z-50 animate-in fade-in zoom-in-95 duration-100 text-xs space-y-1">
                    <div className="p-2 border-b border-slate-100">
                      <div className="font-bold text-slate-900">{user?.full_name}</div>
                      <div className="text-[11px] text-slate-500 font-mono">{user?.email}</div>
                      <span className="badge-info mt-1 inline-flex text-[10px]">
                        Vai trò hiện tại: {user?.role}
                      </span>
                    </div>

                    <div className="py-1 border-b border-slate-100 space-y-0.5">
                      <span className="text-[10px] text-slate-400 font-bold px-2 block uppercase tracking-wider">
                        Chuyển Vai Trò Vận Hành:
                      </span>
                      <button type="button" onClick={() => handleRoleChange('OWNER')} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-100 text-slate-700 font-medium">👑 Chủ Shop (Owner)</button>
                      <button type="button" onClick={() => handleRoleChange('OPS_CSKH')} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-100 text-slate-700 font-medium">🎧 CSKH / Vận Hành (Ops)</button>
                      <button type="button" onClick={() => handleRoleChange('ACCOUNTANT')} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-100 text-slate-700 font-medium">📊 Kế Toán Đối Soát</button>
                      <button type="button" onClick={() => handleRoleChange('WAREHOUSE')} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-100 text-slate-700 font-medium">📦 Thủ Kho Quét Hoàn</button>
                      <button type="button" onClick={() => handleRoleChange('BACKOFFICE')} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-100 text-slate-700 font-medium">🛡️ Quản Trị Hệ Thống (Backoffice)</button>
                    </div>

                    <div className="pt-1 space-y-0.5">
                      {currentRole === 'OWNER' && (
                        <button
                          type="button"
                          onClick={() => { setShopSettingsOpen(true); setUserMenuOpen(false); }}
                          className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-100 text-slate-700 font-medium flex items-center gap-1.5"
                        >
                          <Settings className="w-3.5 h-3.5 text-slate-500" />
                          <span>Cài Đặt Cửa Hàng</span>
                        </button>
                      )}
                      <button type="button" onClick={() => { logout(); setUserMenuOpen(false); }} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-rose-50 text-rose-600 font-bold flex items-center gap-1.5">
                        <LogOut className="w-3.5 h-3.5" /> Đăng xuất
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Role-Scoped Workspace Navigation Bar (Max 4-5 Tabs) */}
          <div className="max-w-[1600px] mx-auto px-4 sm:px-6 flex items-center space-x-1.5 overflow-x-auto custom-scrollbar border-t border-slate-100 py-1.5">
            {currentTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                  {tab.count !== undefined && tab.count > 0 && (
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ml-0.5 ${
                        isActive
                          ? 'bg-white/20 text-white'
                          : tab.countType === 'risk'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </header>

        {/* Main Viewport */}
        <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6">
          {activeTab === 'dashboard' && (
            <ControlTowerTab
              role={user?.role || 'OWNER'}
              exceptions={exceptions}
              discrepancies={discrepancies}
              claims={claims}
              onNavigate={(tab) => setActiveTab(tab)}
            />
          )}

          {activeTab === 'shipments' && (
            <ShipmentListTab
              onOpenTrackingModal={(code) => setSelectedGlobalTracking(code)}
              onNavigateToTab={(tab) => setActiveTab(tab)}
              userRole={user?.role || 'OWNER'}
            />
          )}

          {activeTab === 'exceptions' && (
            <ExceptionWorkboxTab
              exceptions={exceptions}
              onUpdateException={handleUpdateException}
              carrierGhnTier={carrierGhnTier}
            />
          )}

          {activeTab === 'reconciliation' && (
            <ReconciliationTab
              discrepancies={discrepancies}
              onUpdateDiscrepancy={handleUpdateDiscrepancy}
              role={user?.role || 'OWNER'}
            />
          )}

          {activeTab === 'three_ledgers' && <ThreeLedgersTab />}

          {activeTab === 'returns' && <ReturnScanTab />}

          {activeTab === 'claims' && (
            <ClaimCasesTab claims={claims} onUpdateClaim={handleUpdateClaim} />
          )}

          {activeTab === 'api_integrations' && (
            <ApiIntegrationsTab
              carrierGhnTier={carrierGhnTier}
              onToggleGhnTier={(t) => setCarrierGhnTier(t)}
            />
          )}

          {/* Backoffice Dedicated Screens */}
          {activeTab === 'admin_matrix' && (
            <AdminSystemTab activeSection="carrier_matrix" />
          )}

          {activeTab === 'admin_unmapped' && (
            <AdminSystemTab activeSection="unmapped_queue" />
          )}
        </main>
      </div>

      {/* Modern Footer */}
      <footer className="border-t border-slate-200 bg-white text-slate-500 text-xs py-3.5 px-4 sm:px-6 mt-10">
        <div className="max-w-[1600px] mx-auto flex flex-col sm:flex-row justify-between items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900">Ship Dễ Platform</span>
            <span>· Vòng Lặp Kiểm Soát Vận Hành Sau Bán (R1 Control-First)</span>
            <span className="text-slate-300">|</span>
            <span className="text-emerald-700 font-semibold flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Ranh giới COD: Hãng chuyển thẳng về tài khoản shop (BR-10)
            </span>
          </div>

          <div className="flex items-center gap-4 text-[11px] font-semibold text-slate-600">
            <span>Bảo vệ PII BR-42</span>
            <span>Tách quyền tài chính BR-12</span>
            <span>Quét hoàn lũy đẳng BR-40</span>
          </div>
        </div>
      </footer>

      {/* Global Quick Search Modal ⌘K */}
      {globalSearchOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 shadow-2xl border border-slate-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2 font-bold text-sm text-slate-900">
                <Search className="w-4 h-4 text-blue-600" />
                <span>Tra Cứu Mã Vận Đơn Nhanh</span>
              </div>
              <button
                type="button"
                onClick={() => setGlobalSearchOpen(false)}
                className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center font-bold text-xs"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleGlobalSearchSubmit} className="space-y-3">
              <input
                type="text"
                value={globalSearchCode}
                onChange={(e) => setGlobalSearchCode(e.target.value)}
                placeholder="Nhập mã vận đơn (GHN88291042, GHTK77129031)..."
                className="modern-input w-full font-mono uppercase font-bold text-xs"
                autoFocus
              />

              <div className="flex justify-between items-center text-xs text-slate-500">
                <span>Gợi ý: GHN88291042, GHTK77129031</span>
                <button type="submit" className="btn-primary">
                  Mở Hồ Sơ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Shop Settings Modal (Owner Only) */}
      <ShopSettingsModal
        isOpen={shopSettingsOpen}
        onClose={() => setShopSettingsOpen(false)}
        onToast={showToast}
      />

      {/* Upload Statement Modal */}
      <UploadStatementModal
        isOpen={uploadStatementOpen}
        onClose={() => setUploadStatementOpen(false)}
        onUploadComplete={(r) => {
          showToast(`✓ Đã nạp sao kê: ${r.discrepancies_found} dòng lệch`);
          setActiveTab('reconciliation');
        }}
      />

      {/* Unified Tracking Modal */}
      {selectedGlobalTracking && (
        <UnifiedTrackingModal
          trackingCode={selectedGlobalTracking}
          onClose={() => setSelectedGlobalTracking(null)}
          onActionReattempt={() => setActiveTab('exceptions')}
          onActionClaim={() => setActiveTab('claims')}
        />
      )}
    </div>
  );
}
