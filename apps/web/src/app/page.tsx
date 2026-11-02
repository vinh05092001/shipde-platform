'use client';

import React, { useState, useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
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
import { GlobalSearchModal } from '@/components/GlobalSearchModal';

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
  ChevronDown,
  ShieldCheck,
  Store,
  Key,
} from 'lucide-react';

export interface SearchActivationActions {
  setActiveTab: (tab: string) => void;
  setSelectedGlobalTracking: (code: string | null) => void;
  setSelectedOrderId: (id: string | null) => void;
  setSelectedOrderCode: (code: string | null) => void;
  setSelectedBatchId: (id: string | null) => void;
  setSelectedCaseId: (id: string | null) => void;
  setSelectedClaimId: (id: string | null) => void;
  setSelectedClaimCode: (code: string | null) => void;
  setSelectedDiscrepancyId: (id: string | null) => void;
  pushUrl?: (url: string) => void;
  showToast?: (message: string) => void;
}

export function handleSearchResultActivation(
  item: {
    id: string;
    type: string;
    code: string;
    url?: string;
    title?: string;
    metadata?: Record<string, unknown>;
  },
  actions: SearchActivationActions
) {
  // Follow result URL in browser history
  if (actions.pushUrl && item.url) {
    actions.pushUrl(item.url);
  } else if (typeof window !== 'undefined' && item.url) {
    window.history.pushState(null, '', item.url);
  }

  // Clear previous selections across all entity types so consecutive activations do not leave stale selections
  actions.setSelectedGlobalTracking(null);
  actions.setSelectedOrderId(null);
  actions.setSelectedOrderCode(null);
  actions.setSelectedBatchId(null);
  actions.setSelectedCaseId(null);
  actions.setSelectedClaimId(null);
  actions.setSelectedClaimCode(null);
  actions.setSelectedDiscrepancyId(null);

  if (item.type === 'WAYBILL') {
    actions.setSelectedGlobalTracking(item.code);
  } else if (item.type === 'ORDER') {
    actions.setActiveTab('shipments');
    actions.setSelectedOrderId(item.id);
    actions.setSelectedOrderCode(item.code);
  } else if (item.type === 'BATCH') {
    actions.setActiveTab('reconciliation');
    actions.setSelectedBatchId(item.id);
  } else if (item.type === 'CASE') {
    const isClaim =
      item.url?.startsWith('/claims/') ||
      Boolean(item.metadata && 'claim_type' in item.metadata) ||
      item.title?.toLowerCase().includes('bồi thường');
    if (isClaim) {
      actions.setActiveTab('claims');
      actions.setSelectedClaimId(item.id);
      actions.setSelectedClaimCode(item.code);
    } else {
      actions.setActiveTab('exceptions');
      actions.setSelectedCaseId(item.id);
    }
  } else if (item.type === 'TRANSACTION') {
    actions.setActiveTab('reconciliation');
    actions.setSelectedDiscrepancyId(item.id);
  }
}

export default function ShipDeConsoleApp() {
  const { user, merchant, isAuthenticated, isHydrating, switchRole } = useAuth();
  const [authMode, setAuthMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN');

  const searchParams = useSearchParams();
  const pathname = usePathname();
  const routeTab = searchParams.get('view') || 'dashboard';
  const [activeTab, setActiveTabState] = useState<string>(routeTab);
  useEffect(() => {
    // Existing tab content follows links, command selection and browser history.
    if (pathname === '/') Promise.resolve().then(() => setActiveTabState(routeTab));
  }, [pathname, routeTab]);
  const setActiveTab = (tab: string) => {
    setActiveTabState(tab);
    window.history.pushState(null, '', '/?view=' + encodeURIComponent(tab));
  };
  const [carrierGhnTier, setCarrierGhnTier] = useState<'L2' | 'L1'>('L2');

  const [exceptions, setExceptions] = useState<UIExceptionItem[]>(MASTER_EXCEPTIONS);
  const [discrepancies, setDiscrepancies] = useState<UIDiscrepancyItem[]>(MASTER_DISCREPANCIES);
  const [claims, setClaims] = useState<UIClaimItem[]>(MASTER_CLAIMS);

  // Deep search result selections (FEAT-COM-01)
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedOrderCode, setSelectedOrderCode] = useState<string | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const [selectedClaimCode, setSelectedClaimCode] = useState<string | null>(null);
  const [selectedDiscrepancyId, setSelectedDiscrepancyId] = useState<string | null>(null);

  // Modals
  const [createOrderOpen, setCreateOrderOpen] = useState(false);
  const [uploadStatementOpen, setUploadStatementOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [selectedGlobalTracking, setSelectedGlobalTracking] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [syncingPancake, setSyncingPancake] = useState(false);
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

  // Ctrl/Cmd+K belongs to page navigation; preserve entity search on Shift+K.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'k') {
        if (document.querySelector('dialog[open], [role="dialog"]')) return;
        event.preventDefault();
        setGlobalSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
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

  const handleRoleChange = (newRole: any) => {
    switchRole(newRole);
    const newTabs = getTabsForRole(newRole);
    if (!newTabs.some((t) => t.id === activeTab)) {
      setActiveTab(newTabs[0]?.id || 'dashboard');
    }
    showToast(`Đã chuyển vai trò: ${newRole}`);
  };

  // During the single-tick localStorage restore, render nothing rather than a
  // login skeleton that could sit on screen while the user is not signed in.
  // BRAIN.md rule 4: a screen must never stay in a loading frame when the
  // user is not signed in. Once hydration ends, LoginView / RegisterView own
  // empty, validation, error, forbidden and success.
  if (isHydrating) return null;

  if (!isAuthenticated) {
    if (authMode === 'REGISTER') {
      return <RegisterView onSwitchToLogin={() => setAuthMode('LOGIN')} />;
    }
    return <LoginView onSwitchToRegister={() => setAuthMode('REGISTER')} />;
  }

  return (
    <div className="min-h-screen bg-[#FDFCFB] text-slate-900 flex flex-col justify-between font-sans selection:bg-[#c23807] selection:text-white">
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
        <header
          aria-label="Thao tác vận hành"
          className="border-b border-(--border-subtle) bg-(--bg-card)"
        >
          <div className="max-w-[1600px] mx-auto p-4 flex flex-wrap items-center justify-between gap-3">
            {/* Logo & Store Selector */}
            <div className="flex items-center gap-3.5">
              <div
                onClick={() => setActiveTab('dashboard')}
                className="w-8.5 h-8.5 rounded-xl bg-[#c23807] text-white flex items-center justify-center font-black text-base shadow-xs cursor-pointer"
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
                    <Store className="w-3.5 h-3.5 text-[#c23807]" />
                    <span className="truncate max-w-[150px]">{currentStoreObj.name}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  </button>

                  {storeMenuOpen && (
                    <div className="absolute left-0 mt-1.5 w-80 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-xl border border-slate-200 p-2 z-50 animate-in fade-in zoom-in-95 duration-100 text-xs">
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
                              ? 'bg-[#FFF5F0] text-[#c23807] font-bold'
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
            <div className="flex flex-wrap items-center gap-2.5">
              {/* POS Status Badge */}
              <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-semibold">
                <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse" />
                <span>Pancake POS: Đã Kết Nối</span>
              </div>

              {/* Existing entity search: Ctrl/Cmd+Shift+K */}
              <button
                type="button"
                aria-label="Tìm mã đơn hàng"
                aria-keyshortcuts="Control+Shift+K Meta+Shift+K"
                title="Tìm mã đơn hàng (Ctrl hoặc Command Shift K)"
                onClick={() => setGlobalSearchOpen(true)}
                className="flex items-center gap-2 text-xs font-medium text-slate-600 bg-[#F6F5F3] hover:bg-[#EAE7E4] border border-[#EAE7E4] px-3 py-1.5 rounded-lg transition"
              >
                <Search className="w-3.5 h-3.5 text-slate-400" />
                <span>Tìm mã</span>
              </button>

              {/* Manual POS Sync Trigger */}
              <button
                type="button"
                onClick={handleSyncPancake}
                disabled={syncingPancake}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-[#F6F5F3] hover:bg-[#EAE7E4] border border-[#EAE7E4] rounded-lg transition cursor-pointer"
                title="Kích hoạt đồng bộ đơn hàng mới từ Pancake POS"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${syncingPancake ? 'animate-spin text-[#c23807]' : 'text-slate-600'}`}
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
                      ? 'bg-[#c23807] text-white border-[#c23807]'
                      : 'bg-[#F6F5F3] text-slate-700 hover:bg-[#EAE7E4] border-[#EAE7E4]'
                  }`}
                  title="Cài đặt cửa hàng, nhân sự, kết nối hãng và bảo mật"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>Cài Đặt Cửa Hàng</span>
                </button>
              )}

              {/* Existing role preview changes display only; shell permissions come from the server. */}
              <label className="flex items-center gap-2 text-xs">
                <span className="sr-only">Chuyển Vai Trò Vận Hành</span>
                <select
                  aria-label="Chuyển Vai Trò Vận Hành"
                  value={currentRole}
                  onChange={(event) => handleRoleChange(event.target.value)}
                  className="modern-input max-w-40"
                >
                  <option value="OWNER">Chủ Shop (Owner)</option>
                  <option value="OPS_CSKH">CSKH / Vận Hành (Ops)</option>
                  <option value="ACCOUNTANT">Kế Toán Đối Soát</option>
                  <option value="WAREHOUSE">Thủ Kho Quét Hoàn</option>
                  <option value="BACKOFFICE">Quản Trị Hệ Thống</option>
                </select>
              </label>
            </div>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="min-w-0 max-w-[1600px] mx-auto px-4 sm:px-6 py-6">
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
              selectedOrderId={selectedOrderId}
              selectedOrderCode={selectedOrderCode}
              onClearSelection={() => {
                setSelectedOrderId(null);
                setSelectedOrderCode(null);
              }}
            />
          )}

          {activeTab === 'exceptions' && (
            <ExceptionWorkboxTab
              exceptions={exceptions}
              onUpdateException={handleUpdateException}
              carrierGhnTier={carrierGhnTier}
              selectedCaseId={selectedCaseId}
              onClearSelection={() => setSelectedCaseId(null)}
            />
          )}

          {activeTab === 'reconciliation' && (
            <ReconciliationTab
              discrepancies={discrepancies}
              onUpdateDiscrepancy={handleUpdateDiscrepancy}
              role={user?.role || 'OWNER'}
              selectedBatchId={selectedBatchId}
              selectedDiscrepancyId={selectedDiscrepancyId}
              onClearBatchSelection={() => setSelectedBatchId(null)}
              onClearDiscrepancySelection={() => setSelectedDiscrepancyId(null)}
            />
          )}

          {activeTab === 'three_ledgers' && <ThreeLedgersTab />}

          {activeTab === 'returns' && <ReturnScanTab />}

          {activeTab === 'claims' && (
            <ClaimCasesTab
              claims={claims}
              onUpdateClaim={handleUpdateClaim}
              selectedClaimId={selectedClaimId}
              selectedClaimCode={selectedClaimCode}
              onClearSelection={() => {
                setSelectedClaimId(null);
                setSelectedClaimCode(null);
              }}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsWorkspace
              key={searchParams.get('section') || 'stores'}
              initialSection={
                searchParams.get('section') === 'integrations' ? 'integrations' : undefined
              }
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
          <div className="flex flex-wrap justify-center items-center gap-2">
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

      {/* Global Search Modal ⌘K (FEAT-COM-01) */}
      <GlobalSearchModal
        isOpen={globalSearchOpen}
        onClose={() => setGlobalSearchOpen(false)}
        onSelectResult={(item) => {
          setGlobalSearchOpen(false);
          handleSearchResultActivation(item, {
            // Entity results already supply their own URL; preserve that deep link.
            setActiveTab: setActiveTabState,
            setSelectedGlobalTracking,
            setSelectedOrderId,
            setSelectedOrderCode,
            setSelectedBatchId,
            setSelectedCaseId,
            setSelectedClaimId,
            setSelectedClaimCode,
            setSelectedDiscrepancyId,
            showToast,
          });
        }}
      />

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
