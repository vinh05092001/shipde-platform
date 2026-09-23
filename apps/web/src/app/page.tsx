'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { LoginView } from '@/components/auth/LoginView';
import { RegisterView } from '@/components/auth/RegisterView';
import { ActiveRole, UIExceptionItem, UIDiscrepancyItem, UIClaimItem } from '@/components/types';
import {
  MASTER_SHIPMENTS,
  MASTER_EXCEPTIONS,
  MASTER_DISCREPANCIES,
  MASTER_CLAIMS,
  getUnifiedMetrics,
} from '@/services/unifiedDataStore';

import { ShipmentListTab } from '@/components/ShipmentListTab';
import { ControlTowerTab } from '@/components/ControlTowerTab';
import { ThreeLedgersTab } from '@/components/ThreeLedgersTab';
import { ExceptionWorkboxTab } from '@/components/ExceptionWorkboxTab';
import { ReconciliationTab } from '@/components/ReconciliationTab';
import { ReturnScanTab } from '@/components/ReturnScanTab';
import { ClaimCasesTab } from '@/components/ClaimCasesTab';
import { AdminSystemTab } from '@/components/AdminSystemTab';
import { SettingsWorkspace } from '@/components/SettingsWorkspace';
import { UnifiedTrackingModal } from '@/components/UnifiedTrackingModal';
import { UploadStatementModal } from '@/components/UploadStatementModal';
import { CreateOrderModal } from '@/components/CreateOrderModal';

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
} from 'lucide-react';

export default function ShipDeConsoleApp() {
  const { user, merchant, isAuthenticated, isHydrating, logout, switchRole } = useAuth();
  const [authMode, setAuthMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN');

  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [carrierGhnTier, setCarrierGhnTier] = useState<'L2' | 'L1'>('L2');

  const [exceptions, setExceptions] = useState<UIExceptionItem[]>(MASTER_EXCEPTIONS);
  const [discrepancies, setDiscrepancies] = useState<UIDiscrepancyItem[]>(MASTER_DISCREPANCIES);
  const [claims, setClaims] = useState<UIClaimItem[]>(MASTER_CLAIMS);

  // Modals
  const [createOrderOpen, setCreateOrderOpen] = useState(false);
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

  const currentStoreObj = STORES_LIST.find((s) => s.id === selectedStore) || STORES_LIST[0];

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
        showToast('✓ Đã đồng bộ đơn hàng mới từ Pancake POS thành công.');
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
  const metrics = getUnifiedMetrics();

  // Role-based Navigation Tabs (Max 4-5 items per role)
  const getTabsForRole = (role: string) => {
    switch (role) {
      case 'OPS_CSKH':
        return [
          { id: 'dashboard', label: 'Tổng Quan CSKH', icon: LayoutDashboard },
          {
            id: 'exceptions',
            label: 'Hộp Việc Cứu Đơn',
            icon: AlertTriangle,
            count: metrics.openExceptionsCount,
            countType: 'risk',
          },
          { id: 'shipments', label: 'Tra Cứu Vận Đơn', icon: Package },
          {
            id: 'claims',
            label: 'Khiếu Nại Giao Hàng',
            icon: FileText,
            count: metrics.urgentClaimsCount,
            countType: 'warn',
          },
        ];
      case 'ACCOUNTANT':
        return [
          { id: 'dashboard', label: 'Tổng Quan Đối Soát', icon: LayoutDashboard },
          {
            id: 'reconciliation',
            label: 'Đối Soát COD & Cước',
            icon: DollarSign,
            count: metrics.openDiscrepanciesCount,
            countType: 'risk',
          },
          { id: 'shipments', label: 'Tra Cứu Vận Đơn', icon: Package },
          { id: 'three_ledgers', label: 'Báo Cáo Ba Sổ', icon: TrendingUp },
          {
            id: 'claims',
            label: 'Hồ Sơ Bồi Thường',
            icon: FileText,
            count: metrics.urgentClaimsCount,
            countType: 'warn',
          },
        ];
      case 'WAREHOUSE':
        return [
          { id: 'returns', label: 'Tiếp Nhận Hàng Hoàn', icon: RotateCcw },
          { id: 'shipments', label: 'Tra Cứu Vận Đơn Kho', icon: Package },
          { id: 'claims', label: 'Báo Cáo Hàng Hư Hỏng', icon: FileText },
        ];
      case 'BACKOFFICE':
        return [
          { id: 'settings', label: 'Tích Hợp & Cổng Hãng', icon: Key },
          { id: 'admin_matrix', label: 'Ma Trận Năng Lực Hãng', icon: Settings },
          { id: 'admin_unmapped', label: 'Hàng Chờ Trạng Thái Lạ', icon: Database },
        ];
      case 'OWNER':
      default:
        return [
          { id: 'dashboard', label: 'Bàn Điều Khiển & 3 Sổ', icon: LayoutDashboard },
          { id: 'shipments', label: 'Quản Lý Vận Đơn', icon: Package },
          {
            id: 'exceptions',
            label: 'Hộp Việc Cứu Đơn',
            icon: AlertTriangle,
            count: metrics.openExceptionsCount,
            countType: 'risk',
          },
          {
            id: 'reconciliation',
            label: 'Đối Soát COD & Cước',
            icon: DollarSign,
            count: metrics.openDiscrepanciesCount,
            countType: 'risk',
          },
          { id: 'returns', label: 'Quản Lý Nhập Hoàn', icon: RotateCcw },
        ];
    }
  };

  const currentTabs = getTabsForRole(currentRole);

  const handleRoleChange = (newRole: any) => {
    switchRole(newRole);
    setUserMenuOpen(false);
    const newTabs = getTabsForRole(newRole);
    if (!newTabs.some((t) => t.id === activeTab)) {
      setActiveTab(newTabs[0].id);
    }
    showToast(`Đã chuyển vai trò: ${newRole}`);
  };

  // During the single-tick localStorage restore, show nothing rather than a
  // loading skeleton that could persist when the user is not signed in.
  // isHydrating resolves to false immediately after the effect runs on the
  // client (BRAIN.md rule 4: a screen must never stay in a loading frame
  // when the user is not signed in).
  if (isHydrating) {
    return null;
  }

  if (!isAuthenticated) {
    if (authMode === 'REGISTER') {
      return <RegisterView onSwitchToLogin={() => setAuthMode('LOGIN')} />;
    }
    return <LoginView onSwitchToRegister={() => setAuthMode('REGISTER')} />;
  }

  return (
    <div className="min-h-screen bg-[#FDFCFB] text-slate-900 flex flex-col justify-between font-sans selection:bg-[#EA4B12] selection:text-white">
      <div>
        {/* Global Toast Notification */}
        {toastMessage && (
          <div className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl border border-slate-700 text-xs font-semibold flex items-center gap-2.5 animate-in slide-in-from-bottom-2 duration-150">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>{toastMessage}</span>
            <button
              onClick={() => setToastMessage(null)}
              className="text-slate-400 hover:text-white font-bold ml-2"
            >
              ✕
            </button>
          </div>
        )}

        {/* Top Header */}
        <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-[#EAE7E4] shadow-xs">
          <div className="max-w-[1600px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
            {/* Logo & Store Selector */}
            <div className="flex items-center gap-3.5">
              <div
                onClick={() => setActiveTab('dashboard')}
                className="w-8.5 h-8.5 rounded-xl bg-[#EA4B12] text-white flex items-center justify-center font-black text-base shadow-xs cursor-pointer"
              >
                S
              </div>
              <div className="flex items-center gap-2">
                <span
                  onClick={() => setActiveTab('dashboard')}
                  className="font-black text-slate-900 text-base tracking-tight cursor-pointer"
                >
                  Ship Dễ
                </span>

                {/* Branch Selector */}
                <div className="relative ml-2">
                  <button
                    type="button"
                    onClick={() => setStoreMenuOpen(!storeMenuOpen)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 bg-[#F6F5F3] hover:bg-[#EAE7E4] px-3 py-1.5 rounded-lg border border-[#EAE7E4] transition cursor-pointer"
                  >
                    <Store className="w-3.5 h-3.5 text-[#EA4B12]" />
                    <span className="truncate max-w-[150px]">{currentStoreObj.name}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  </button>

                  {storeMenuOpen && (
                    <div className="absolute left-0 mt-1.5 w-80 bg-white rounded-xl shadow-xl border border-slate-200 p-2 z-50 animate-in fade-in zoom-in-95 duration-100 text-xs">
                      <div className="px-2.5 py-1.5 border-b border-slate-100 font-bold text-[11px] text-slate-400 uppercase tracking-wider">
                        Phạm Vi Chi Nhánh / Kho Xuất Hàng:
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
                          className={`w-full text-left px-3 py-2 rounded-lg transition flex items-center justify-between ${
                            selectedStore === store.id
                              ? 'bg-[#FFF5F0] text-[#EA4B12] font-bold'
                              : 'hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          <span className="truncate">{store.name}</span>
                          <span className="font-mono text-xs text-slate-400">{store.code}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Top Operational Status & Actions */}
            <div className="flex items-center gap-2.5">
              {/* POS Status Badge */}
              <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-semibold">
                <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse" />
                <span>Pancake POS: Đã Kết Nối</span>
              </div>

              {/* Quick Search Shortcut ⌘K */}
              <button
                type="button"
                onClick={() => setGlobalSearchOpen(true)}
                className="hidden sm:flex items-center gap-2 text-xs font-medium text-slate-600 bg-[#F6F5F3] hover:bg-[#EAE7E4] border border-[#EAE7E4] px-3 py-1.5 rounded-lg transition"
              >
                <Search className="w-3.5 h-3.5 text-slate-400" />
                <span>Tìm mã</span>
                <kbd className="font-mono text-[11px] bg-white text-slate-600 px-1.5 py-0.5 rounded border border-[#EAE7E4] shadow-2xs">
                  ⌘K
                </kbd>
              </button>

              {/* Manual POS Sync Trigger */}
              <button
                type="button"
                onClick={handleSyncPancake}
                disabled={syncingPancake}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-[#F6F5F3] hover:bg-[#EAE7E4] border border-[#EAE7E4] rounded-lg transition cursor-pointer"
                title="Kích hoạt đồng bộ đơn hàng mới từ Pancake POS"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${syncingPancake ? 'animate-spin text-[#EA4B12]' : 'text-slate-600'}`}
                />
                <span>Đồng bộ POS</span>
              </button>

              {/* Create Shipment / Order CTA */}
              {(currentRole === 'OWNER' || currentRole === 'OPS_CSKH') && (
                <button
                  type="button"
                  onClick={() => setCreateOrderOpen(true)}
                  className="btn-primary text-xs shrink-0 py-1.5 px-3"
                  title="Tạo đơn hàng thủ công và so sánh cước đa hãng"
                >
                  <span>+ Tạo Đơn Hàng</span>
                </button>
              )}

              {/* Settings (Full-Page View) */}
              {currentRole === 'OWNER' && (
                <button
                  type="button"
                  onClick={() => setActiveTab('settings')}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg border transition cursor-pointer ${
                    activeTab === 'settings'
                      ? 'bg-[#EA4B12] text-white border-[#EA4B12]'
                      : 'bg-[#F6F5F3] text-slate-700 hover:bg-[#EAE7E4] border-[#EAE7E4]'
                  }`}
                  title="Cài đặt cửa hàng, nhân sự, kết nối hãng và bảo mật"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>Cài Đặt Cửa Hàng</span>
                </button>
              )}

              {/* User Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-2 bg-[#F6F5F3] hover:bg-[#EAE7E4] px-2.5 py-1.5 rounded-lg border border-[#EAE7E4] transition text-xs font-semibold"
                >
                  <div className="w-6.5 h-6.5 rounded-md bg-[#0C1421] text-white flex items-center justify-center text-xs font-bold">
                    {user?.full_name?.charAt(0) || 'U'}
                  </div>
                  <div className="hidden md:block text-left pr-1">
                    <div className="text-xs text-slate-900 leading-tight truncate max-w-[120px]">
                      {user?.full_name}
                    </div>
                    <div className="text-[11px] text-[#EA4B12] font-semibold leading-none">
                      {user?.role}
                    </div>
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                </button>

                {userMenuOpen && (
                  <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-2xl border border-slate-200 p-2 z-50 animate-in fade-in zoom-in-95 duration-100 text-xs space-y-1">
                    <div className="p-2 border-b border-slate-100">
                      <div className="font-bold text-slate-900">{user?.full_name}</div>
                      <div className="text-xs text-slate-500 font-mono">{user?.email}</div>
                      <span className="badge-info mt-1.5 inline-flex text-xs">
                        Vai trò: {user?.role}
                      </span>
                    </div>

                    <div className="py-1 border-b border-slate-100 space-y-0.5">
                      <span className="text-[11px] text-slate-400 font-bold px-2 block uppercase tracking-wider">
                        Chuyển Vai Trò Vận Hành:
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRoleChange('OWNER')}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-50 text-slate-700 font-medium"
                      >
                        👑 Chủ Shop (Owner)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRoleChange('OPS_CSKH')}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-50 text-slate-700 font-medium"
                      >
                        🎧 CSKH / Vận Hành (Ops)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRoleChange('ACCOUNTANT')}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-50 text-slate-700 font-medium"
                      >
                        📊 Kế Toán Đối Soát
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRoleChange('WAREHOUSE')}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-50 text-slate-700 font-medium"
                      >
                        📦 Thủ Kho Quét Hoàn
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRoleChange('BACKOFFICE')}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-50 text-slate-700 font-medium"
                      >
                        🛡️ Quản Trị Hệ Thống
                      </button>
                    </div>

                    <div className="pt-1 space-y-0.5">
                      {currentRole === 'OWNER' && (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab('settings');
                            setUserMenuOpen(false);
                          }}
                          className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-50 text-slate-700 font-medium flex items-center gap-1.5"
                        >
                          <Settings className="w-3.5 h-3.5 text-slate-500" />
                          <span>Cài Đặt Cửa Hàng</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          logout();
                          setUserMenuOpen(false);
                        }}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-rose-50 text-rose-600 font-bold flex items-center gap-1.5"
                      >
                        <LogOut className="w-3.5 h-3.5" /> Đăng xuất
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Role Navigation Bar */}
          {activeTab !== 'settings' && (
            <div className="max-w-[1600px] mx-auto px-4 sm:px-6 flex items-center space-x-1.5 overflow-x-auto custom-scrollbar border-t border-[#EAE7E4] py-2">
              {currentTabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-4 py-2 text-xs font-bold rounded-xl transition whitespace-nowrap flex items-center gap-2 cursor-pointer ${
                      isActive
                        ? 'bg-[#EA4B12] text-white shadow-xs'
                        : 'text-slate-700 hover:bg-[#F6F5F3] hover:text-slate-900'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{tab.label}</span>
                    {tab.count !== undefined && tab.count > 0 && (
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-bold ml-0.5 ${
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
          )}
        </header>

        {/* Main Viewport */}
        <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6">
          {activeTab === 'dashboard' && (
            <ControlTowerTab
              role={user?.role || 'OWNER'}
              onNavigate={(tab) => setActiveTab(tab)}
              onCreateOrder={() => setCreateOrderOpen(true)}
            />
          )}

          {activeTab === 'shipments' && (
            <ShipmentListTab
              onOpenTrackingModal={(code) => setSelectedGlobalTracking(code)}
              onNavigateToTab={(tab) => setActiveTab(tab)}
              onCreateOrder={() => setCreateOrderOpen(true)}
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

          {activeTab === 'settings' && (
            <SettingsWorkspace
              onBackToDashboard={() => setActiveTab('dashboard')}
              onToast={showToast}
              carrierGhnTier={carrierGhnTier}
              onToggleGhnTier={(t) => setCarrierGhnTier(t)}
            />
          )}

          {/* Backoffice System Management */}
          {activeTab === 'admin_matrix' && <AdminSystemTab activeSection="carrier_matrix" />}

          {activeTab === 'admin_unmapped' && <AdminSystemTab activeSection="unmapped_queue" />}
        </main>
      </div>

      {/* Modern Footer */}
      <footer className="border-t border-[#EAE7E4] bg-white text-slate-500 text-xs py-4 px-4 sm:px-6 mt-12">
        <div className="max-w-[1600px] mx-auto flex flex-col sm:flex-row justify-between items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900">Ship Dễ Platform</span>
            <span>· Hệ thống điều hành & kiểm soát vận tải sau bán</span>
            <span className="text-slate-300">|</span>
            <span className="text-emerald-700 font-semibold flex items-center gap-1">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              Tiền COD chuyển thẳng về tài khoản ngân hàng của Shop
            </span>
          </div>

          <div className="flex items-center gap-4 text-xs font-semibold text-slate-600">
            <span>Bảo vệ PII</span>
            <span>Tách quyền tài chính Maker-Checker</span>
            <span>Quét hoàn lũy đẳng</span>
          </div>
        </div>
      </footer>

      {/* Global Quick Search Modal ⌘K */}
      {globalSearchOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2 font-bold text-sm text-slate-900">
                <Search className="w-4 h-4 text-[#EA4B12]" />
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
                className="modern-input w-full font-mono uppercase font-bold text-sm"
                autoFocus
              />

              <div className="flex justify-between items-center text-xs text-slate-500">
                <span>Gợi ý: GHN88291042, GHTK77129031</span>
                <button type="submit" className="btn-primary text-xs">
                  Mở Hồ Sơ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Statement Upload Modal */}
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

      {/* Manual Order Creation & Rate Comparison Modal */}
      <CreateOrderModal
        isOpen={createOrderOpen}
        onClose={() => setCreateOrderOpen(false)}
        onOrderCreated={(newOrder) => {
          showToast(
            `✓ Đã tạo vận đơn mới ${newOrder.tracking_code} (${newOrder.carrier_code}) và đẩy sang hãng thành công.`
          );
          setActiveTab('shipments');
        }}
      />
    </div>
  );
}
