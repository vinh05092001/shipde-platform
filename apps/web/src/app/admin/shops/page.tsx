'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import {
  Store,
  Plus,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Copy,
  Check,
  Search,
  ShieldAlert,
  ArrowRight,
  ExternalLink,
  Users,
  Key,
} from 'lucide-react';

export interface ShopRecord {
  id: string;
  name: string;
  code: string;
  status: string;
  created_at: string;
  user_count?: number;
  owner?: {
    id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
  } | null;
}

export interface CreatedShopSuccessData {
  merchant: {
    id: string;
    name: string;
    code: string;
    status: string;
    created_at: string;
  };
  user: {
    id: string;
    merchant_id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    role: string;
    status: string;
    email_verified_at: string | null;
    phone_verified_at: string | null;
  };
  password_is_temporary: boolean;
}

export default function AdminShopsPage() {
  const { user, isAuthenticated, isHydrating } = useAuth();

  // Navigation / Modal tab state
  const [showCreateModal, setShowCreateModal] = useState(false);

  // List data states
  const [shops, setShops] = useState<ShopRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Creation form states
  const [merchantName, setMerchantName] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdSuccess, setCreatedSuccess] = useState<CreatedShopSuccessData | null>(null);
  const [copiedPass, setCopiedPass] = useState(false);

  // Fetch shops
  const fetchShops = useCallback(async () => {
    setIsLoading(true);
    setListError(null);
    try {
      const res = await fetch(`/api/admin/shops?search=${encodeURIComponent(searchQuery)}`, {
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          errData?.error?.message || `Lỗi tải danh sách cửa hàng (HTTP ${res.status})`
        );
      }

      const json = await res.json();
      setShops(json?.data?.shops || []);
    } catch (err: any) {
      setListError(err.message || 'Không thể kết nối đến máy chủ');
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    if (isAuthenticated && user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
      void fetchShops();
    }
  }, [isAuthenticated, user, fetchShops]);

  // AC-ADMIN-15: Signed-out users access admin routes must reach the forbidden state
  // before any loading skeleton or in-flight state
  if (!isHydrating && (!isAuthenticated || !user)) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div
          data-testid="state-forbidden"
          className="max-w-md w-full bg-white rounded-xl shadow-lg border border-red-200 p-8 text-center"
        >
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">
            Truy cập bị từ chối (403 Forbidden)
          </h1>
          <p className="text-slate-600 text-sm mb-6 leading-relaxed">
            Bạn cần đăng nhập với quyền Quản trị viên (Operator) để xem danh sách và khởi tạo cửa
            hàng trên hệ thống.
          </p>
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors text-sm"
          >
            Đăng nhập ngay
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </main>
    );
  }

  // Client-side form validation
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!merchantName.trim() || merchantName.trim().length < 2) {
      errors.merchant_name = 'Tên cửa hàng phải có ít nhất 2 ký tự';
    } else if (merchantName.trim().length > 255) {
      errors.merchant_name = 'Tên cửa hàng không được vượt quá 255 ký tự';
    }

    const trimmedEmail = email.trim();
    const trimmedPhone = phone.trim();

    if (!trimmedEmail && !trimmedPhone) {
      errors.email = 'Phải cung cấp ít nhất email hoặc số điện thoại';
      errors.phone = 'Phải cung cấp ít nhất email hoặc số điện thoại';
    }

    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      errors.email = 'Định dạng email không hợp lệ';
    }

    if (trimmedPhone && !/^(0|\+84)[3|5|7|8|9][0-9]{8}$/.test(trimmedPhone.replace(/\s+/g, ''))) {
      errors.phone = 'Số điện thoại không hợp lệ theo định dạng Việt Nam';
    }

    if (password && password.length < 8) {
      errors.password = 'Mật khẩu phải có độ dài tối thiểu 8 ký tự';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateShop = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreatedSuccess(null);

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/admin/shops', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          merchant_name: merchantName.trim(),
          full_name: fullName.trim() || merchantName.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          password: password || undefined,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        if (json?.error?.fields && Array.isArray(json.error.fields)) {
          const fieldMap: Record<string, string> = {};
          json.error.fields.forEach((f: any) => {
            fieldMap[f.field] = f.message;
          });
          setFormErrors(fieldMap);
        }
        throw new Error(json?.error?.message || `Khởi tạo thất bại (HTTP ${res.status})`);
      }

      setCreatedSuccess(json.data);
      // Reset form
      setMerchantName('');
      setFullName('');
      setEmail('');
      setPhone('');
      setPassword('');
      setFormErrors({});

      // Refresh shop list
      fetchShops();
    } catch (err: any) {
      setCreateError(err.message || 'Lỗi khi khởi tạo cửa hàng');
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyTemporaryPassword = (pwd: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(pwd);
      setCopiedPass(true);
      setTimeout(() => setCopiedPass(false), 3000);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-12">
      {/* Top Navbar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold shadow-indigo-100 shadow-md">
              SD
            </div>
            <div>
              <span className="font-semibold text-slate-800 text-base">Ship Dễ</span>
              <span className="ml-2 text-xs font-medium px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full border border-indigo-200">
                Admin Console
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-xs text-slate-500 hover:text-slate-800 font-medium px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
            >
              Về bảng điều khiển
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        {/* Header Title Section */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Quản lý Cửa hàng (Shop Accounts)
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Khởi tạo và cấu hình tài khoản chủ cửa hàng ban đầu độc quyền bởi quản trị viên
              (FEAT-AUTH-02)
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => fetchShops()}
              disabled={isLoading}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 shadow-sm transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              Làm mới
            </button>
            <button
              onClick={() => {
                setShowCreateModal(true);
                setCreatedSuccess(null);
                setCreateError(null);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm shadow-indigo-200 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Khởi tạo cửa hàng mới
            </button>
          </div>
        </div>

        {/* Success Banner if recently created */}
        {createdSuccess && (
          <div
            data-testid="state-success"
            className="mb-8 p-6 bg-emerald-50 border border-emerald-200 rounded-xl shadow-sm"
          >
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-lg flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold text-emerald-900">
                  Khởi tạo cửa hàng thành công! (Mã: {createdSuccess.merchant.code})
                </h3>
                <p className="text-sm text-emerald-700 mt-0.5">
                  Tài khoản chủ sở hữu đã được kích hoạt trực tiếp ở trạng thái{' '}
                  <span className="font-semibold uppercase text-emerald-800">
                    {createdSuccess.merchant.status}
                  </span>{' '}
                  và xác thực tự động.
                </p>

                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 bg-white p-4 rounded-lg border border-emerald-100">
                  <div>
                    <span className="text-xs text-slate-500 block">Tên cửa hàng</span>
                    <span className="text-sm font-semibold text-slate-800">
                      {createdSuccess.merchant.name}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 block">Mã định danh (Code)</span>
                    <span className="text-sm font-mono font-medium text-indigo-600">
                      {createdSuccess.merchant.code}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 block">Chủ sở hữu</span>
                    <span className="text-sm text-slate-800">
                      {createdSuccess.user.full_name} (
                      {createdSuccess.user.email || createdSuccess.user.phone})
                    </span>
                  </div>
                </div>

                {/* Initial Setup Notification */}
                {createdSuccess.password_is_temporary && (
                  <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-3">
                    <Key className="w-5 h-5 text-blue-600 shrink-0" />
                    <div>
                      <span className="text-xs font-semibold text-blue-900 block">
                        Thiết lập mật khẩu lần đầu:
                      </span>
                      <p className="text-xs text-blue-800 leading-relaxed mt-0.5">
                        Liên kết thiết lập mật khẩu một lần bảo mật đã được gửi tới chủ cửa hàng qua{' '}
                        <strong>{createdSuccess.user.email || createdSuccess.user.phone}</strong>.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* List Error State */}
        {listError && (
          <div
            data-testid="state-error"
            className="mb-8 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
              <div>
                <h4 className="text-sm font-semibold text-red-900">Không thể tải dữ liệu</h4>
                <p className="text-xs text-red-700">{listError}</p>
              </div>
            </div>
            <button
              onClick={() => fetchShops()}
              className="px-3 py-1.5 bg-white border border-red-300 text-red-700 text-xs font-medium rounded-md hover:bg-red-50 transition-colors"
            >
              Thử lại
            </button>
          </div>
        )}

        {/* Search Bar */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-6 flex items-center gap-4">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm kiếm theo tên cửa hàng hoặc mã cửa hàng..."
              className="w-full pl-10 pr-4 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Shop List Section */}
        {isLoading ? (
          /* Loading State */
          <div data-testid="state-loading" className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm animate-pulse flex items-center justify-between"
              >
                <div className="space-y-2">
                  <div className="h-5 bg-slate-200 rounded w-48" />
                  <div className="h-4 bg-slate-100 rounded w-32" />
                </div>
                <div className="h-8 bg-slate-200 rounded w-24" />
              </div>
            ))}
          </div>
        ) : shops.length === 0 ? (
          /* Empty State */
          <div
            data-testid="state-empty"
            className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center"
          >
            <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <Store className="w-8 h-8" />
            </div>
            <h3 className="text-base font-semibold text-slate-900 mb-1">
              Chưa có cửa hàng nào được khởi tạo
            </h3>
            <p className="text-sm text-slate-500 max-w-sm mx-auto mb-6">
              Hệ thống chưa có shop nào. Bấm nút bên dưới để khởi tạo tài khoản cửa hàng đầu tiên.
            </p>
            <button
              onClick={() => {
                setShowCreateModal(true);
                setCreatedSuccess(null);
                setCreateError(null);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              Khởi tạo cửa hàng ngay
            </button>
          </div>
        ) : (
          /* Shop Cards / Table */
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-slate-500 font-medium text-xs uppercase tracking-wider text-left">
                  <tr>
                    <th scope="col" className="px-6 py-3.5">
                      Tên cửa hàng
                    </th>
                    <th scope="col" className="px-6 py-3.5">
                      Mã cửa hàng
                    </th>
                    <th scope="col" className="px-6 py-3.5">
                      Chủ tài khoản
                    </th>
                    <th scope="col" className="px-6 py-3.5">
                      Trạng thái
                    </th>
                    <th scope="col" className="px-6 py-3.5">
                      Ngày tạo
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-700">
                  {shops.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 font-medium text-slate-900 flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-xs">
                          {s.name.slice(0, 2).toUpperCase()}
                        </div>
                        {s.name}
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-indigo-700 font-medium">
                        {s.code}
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-800">
                          {s.owner?.full_name || 'Chưa cập nhật'}
                        </div>
                        <div className="text-xs text-slate-400">
                          {s.owner?.email || s.owner?.phone || '—'}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {s.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-500">
                        {new Date(s.created_at).toLocaleDateString('vi-VN', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Modal for Shop Creation */}
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in duration-150">
              <div className="px-6 py-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center">
                    <Store className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-900">Khởi tạo cửa hàng mới</h2>
                    <p className="text-xs text-slate-500">
                      Cấp tài khoản chủ shop không qua đăng ký công khai
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleCreateShop} className="p-6 space-y-4">
                {/* Form-level Error Alert */}
                {createError && (
                  <div
                    data-testid="state-error"
                    className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2"
                  >
                    <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
                    <span>{createError}</span>
                  </div>
                )}

                {/* Validation errors summary */}
                {Object.keys(formErrors).length > 0 && (
                  <div
                    data-testid="state-validation"
                    className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800"
                  >
                    <p className="font-semibold mb-1">Vui lòng kiểm tra lại thông tin:</p>
                    <ul className="list-disc list-inside space-y-0.5">
                      {Object.values(formErrors).map((msg, idx) => (
                        <li key={idx}>{msg}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Merchant Name Input */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tên cửa hàng (Shop Name) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={merchantName}
                    onChange={(e) => setMerchantName(e.target.value)}
                    placeholder="VD: An An Boutique, Giao Hàng Siêu Tốc"
                    className={`w-full px-3.5 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                      formErrors.merchant_name ? 'border-red-300 bg-red-50/20' : 'border-slate-300'
                    }`}
                  />
                  {formErrors.merchant_name && (
                    <p className="text-xs text-red-600 mt-1">{formErrors.merchant_name}</p>
                  )}
                </div>

                {/* Owner Full Name Input */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Họ và tên chủ cửa hàng
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="VD: Nguyễn Văn An"
                    className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                {/* Email Input */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Địa chỉ Email (hoặc SĐT)
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="owner@shop.vn"
                    className={`w-full px-3.5 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                      formErrors.email ? 'border-red-300 bg-red-50/20' : 'border-slate-300'
                    }`}
                  />
                  {formErrors.email && (
                    <p className="text-xs text-red-600 mt-1">{formErrors.email}</p>
                  )}
                </div>

                {/* Phone Input */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Số điện thoại liên hệ (Định dạng VN)
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0901234567 hoặc +84901234567"
                    className={`w-full px-3.5 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                      formErrors.phone ? 'border-red-300 bg-red-50/20' : 'border-slate-300'
                    }`}
                  />
                  {formErrors.phone && (
                    <p className="text-xs text-red-600 mt-1">{formErrors.phone}</p>
                  )}
                </div>

                {/* Custom Password Input */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Mật khẩu tùy chọn (Bỏ trống để tự động sinh mật khẩu tạm thời)
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Tối thiểu 8 ký tự (hoặc để trống)"
                    className={`w-full px-3.5 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                      formErrors.password ? 'border-red-300 bg-red-50/20' : 'border-slate-300'
                    }`}
                  />
                  {formErrors.password && (
                    <p className="text-xs text-red-600 mt-1">{formErrors.password}</p>
                  )}
                  <p className="text-2xs text-slate-400 mt-1">
                    Nếu để trống, hệ thống sẽ tự động tạo mật khẩu mạnh và hiển thị sau khi khởi tạo
                    thành công.
                  </p>
                </div>

                {/* Actions */}
                <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm shadow-indigo-200 transition-colors disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Đang khởi tạo...
                      </>
                    ) : (
                      'Tạo cửa hàng'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
