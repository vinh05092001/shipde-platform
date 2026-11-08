'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Truck, Database, ShieldAlert } from 'lucide-react';
import { CarrierCatalogView } from '@/features/carriers/catalog';
import { useAuth } from '@/context/AuthContext';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface CarriersSettingsPageProps {
  initialCarriers?: any[] | null;
  initialLoading?: boolean;
  initialError?: string | null;
  initialForbidden?: boolean;
  initialCorrelationId?: string | null;
}

export default function CarriersSettingsPage({
  initialCarriers = null,
  initialLoading = false,
  initialError = null,
  initialForbidden = false,
  initialCorrelationId = null,
}: CarriersSettingsPageProps) {
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState<'accounts' | 'catalog'>('accounts');

  // Carrier Accounts state
  const [accounts, setAccounts] = useState<any[]>([]);
  const [accountsLoading, setAccountsLoading] = useState<boolean>(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [accountsForbidden, setAccountsForbidden] = useState(false);

  const fetchAccounts = useCallback(async () => {
    if (accountsForbidden) return;
    setAccountsLoading(true);
    setAccountsError(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/api/v1/carrier-accounts`, { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 403) {
          setAccountsForbidden(true);
          throw new Error('Bạn không có quyền xem tài khoản hãng vận chuyển.');
        }
        throw new Error(data.error?.message || 'Không thể tải danh sách tài khoản');
      }
      setAccounts(data.data || []);
    } catch (err: any) {
      setAccountsError(err.message || 'Lỗi khi tải tài khoản hãng vận chuyển');
    } finally {
      setAccountsLoading(false);
    }
  }, [token, accountsForbidden]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial accounts fetch
    fetchAccounts();
  }, [fetchAccounts]);

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Navigation Breadcrumb and Sub-nav */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Quay lại Bảng Điều Khiển</span>
            </Link>
            <span className="text-slate-300">/</span>
            <span className="text-xs font-bold text-slate-700">Hãng Vận Chuyển (SCR-CAR-01)</span>
          </div>

          {/* Tab Navigation */}
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('accounts')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition ${
                activeTab === 'accounts'
                  ? 'bg-blue-50 border border-blue-200 text-blue-700'
                  : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300'
              }`}
              data-testid="tab-accounts"
            >
              <Database className="w-3.5 h-3.5" />
              <span>Tài khoản hãng</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('catalog')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition ${
                activeTab === 'catalog'
                  ? 'bg-orange-50 border border-orange-200 text-orange-700'
                  : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300'
              }`}
              data-testid="tab-catalog"
            >
              <Truck className="w-3.5 h-3.5" />
              <span>Danh mục hãng vận chuyển</span>
            </button>
          </div>
        </div>

        {/* TAB 1: Read-only accounts; connection actions belong to FEAT-CAR-02 */}
        {activeTab === 'accounts' && (
          <div className="space-y-5" data-testid="carrier-accounts-tab">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h1 className="text-base font-bold text-slate-800">Tài khoản Hãng Vận Chuyển</h1>
                  <p className="text-xs text-slate-500">
                    Quản lý kết nối, thông tin xác thực và khả năng của từng tài khoản hãng
                  </p>
                </div>
              </div>
            </div>

            {accountsForbidden ? (
              <div
                className="p-8 text-center bg-amber-50/60 border border-amber-200 rounded-2xl space-y-2"
                data-testid="accounts-forbidden"
              >
                <ShieldAlert className="w-12 h-12 text-amber-600 mx-auto" />
                <h4 className="font-bold text-sm text-slate-800">403 — Không Có Quyền Truy Cập</h4>
                <p className="text-xs text-slate-600 max-w-md mx-auto">
                  Tài khoản của bạn không có quyền xem tài khoản hãng vận chuyển. Vui lòng liên hệ
                  Chủ cửa hàng (OWNER) để được cấp quyền.
                </p>
              </div>
            ) : accountsError ? (
              <div
                role="alert"
                className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center justify-between"
                data-testid="accounts-error"
              >
                <div className="flex items-center gap-2">
                  <svg
                    className="w-4 h-4 text-rose-600 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <span>{accountsError}</span>
                </div>
                <button
                  type="button"
                  onClick={fetchAccounts}
                  className="btn-secondary text-xs py-1 px-3 bg-white hover:bg-slate-50"
                >
                  Thử lại
                </button>
              </div>
            ) : accountsLoading ? (
              <div className="space-y-4" data-testid="accounts-loading">
                <div className="p-8 bg-white border border-slate-200 rounded-2xl flex flex-col items-center justify-center gap-3">
                  <svg
                    className="w-8 h-8 text-blue-500 animate-spin"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  <p className="text-xs font-semibold text-slate-600">
                    Đang tải tài khoản hãng vận chuyển...
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[1, 2].map((i) => (
                    <div
                      key={i}
                      className="p-5 bg-white border border-slate-200 rounded-2xl space-y-3 animate-pulse"
                    >
                      <div className="h-4 bg-slate-200 rounded-md w-1/3" />
                      <div className="h-3 bg-slate-100 rounded-md w-2/3" />
                      <div className="h-3 bg-slate-100 rounded-md w-1/2" />
                    </div>
                  ))}
                </div>
              </div>
            ) : accounts.length === 0 ? (
              <div
                className="p-12 bg-white border border-dashed border-slate-300 rounded-2xl text-center space-y-4"
                data-testid="accounts-empty"
              >
                <div className="w-12 h-12 mx-auto rounded-full bg-blue-50 text-blue-500 flex items-center justify-center">
                  <Database className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-slate-800">
                    Chưa có tài khoản hãng vận chuyển nào
                  </h3>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    Danh mục hãng vận chuyển cung cấp thông tin tham khảo. Kết nối tài khoản được
                    triển khai riêng trong tính năng quản lý kết nối.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4" data-testid="accounts-list">
                {accounts.map((acc: any) => (
                  <div
                    key={acc.id}
                    className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs"
                    data-testid={`carrier-account-${acc.id}`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-lg">
                        {acc.carrier_code?.charAt(0) || '?'}
                      </div>
                      <div className="flex-1">
                        <h4 className="font-bold text-sm text-slate-900">
                          {acc.carrier_code} - {acc.alias || 'Chưa đặt bí danh'}
                        </h4>
                        <p className="text-xs text-slate-500">
                          Môi trường: {acc.environment || 'production'} | Trạng thái:{' '}
                          {acc.status || 'unknown'}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Carrier Catalog (FEAT-CAR-01 Slice B) */}
        <div hidden={activeTab !== 'catalog'}>
          <CarrierCatalogView
            initialCarriers={initialCarriers}
            initialLoading={initialLoading}
            initialError={initialError}
            initialForbidden={initialForbidden}
            initialCorrelationId={initialCorrelationId}
          />
        </div>
      </div>
    </div>
  );
}
