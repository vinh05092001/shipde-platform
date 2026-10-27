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
  users: Array<{
    id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    role: string;
    status: string;
    email_verified_at: string | null;
    phone_verified_at: string | null;
  }>;
}

export interface CreatedShopSuccessData {
  merchant: { id: string; name: string; code: string; status: string; created_at: string };
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

export function validateShopForm(
  merchantName: string,
  email: string,
  phone: string,
  password?: string
): Record<string, string> {
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

  return errors;
}

export interface AdminShopsViewProps {
  isAuthenticated: boolean;
  user: any;
  isPlatformAdmin: boolean;
  isHydrating: boolean;
  shops: ShopRecord[];
  isLoading: boolean;
  listError: string | null;
  searchQuery: string;
  setSearchQuery?: (q: string) => void;
  showCreateModal: boolean;
  setShowCreateModal?: (s: boolean) => void;
  merchantName?: string;
  setMerchantName?: (v: string) => void;
  fullName?: string;
  setFullName?: (v: string) => void;
  email?: string;
  setEmail?: (v: string) => void;
  phone?: string;
  setPhone?: (v: string) => void;
  password?: string;
  setPassword?: (v: string) => void;
  isSubmitting?: boolean;
  formErrors?: Record<string, string>;
  createError?: string | null;
  createdSuccess?: CreatedShopSuccessData | null;
  onRefresh?: () => void;
  onCreateSubmit?: (e: React.FormEvent) => void;
}

export function AdminShopsView({
  isAuthenticated,
  user,
  isPlatformAdmin,
  isHydrating,
  shops,
  isLoading,
  listError,
  searchQuery,
  setSearchQuery,
  showCreateModal,
  setShowCreateModal,
  merchantName = '',
  setMerchantName,
  fullName = '',
  setFullName,
  email = '',
  setEmail,
  phone = '',
  setPhone,
  password = '',
  setPassword,
  isSubmitting = false,
  formErrors = {},
  createError = null,
  createdSuccess = null,
  onRefresh,
  onCreateSubmit,
}: AdminShopsViewProps) {
  // AC-ADMIN-15: Signed-out or non-admin users reach the forbidden state immediately
  // before any loading skeleton or in-flight state
  if (!isHydrating && (!isAuthenticated || !user || !isPlatformAdmin)) {
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
              onClick={() => onRefresh && onRefresh()}
              disabled={isLoading}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 shadow-sm transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              Làm mới
            </button>
            <button
              onClick={() => setShowCreateModal && setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              Khởi tạo Cửa hàng Mới
            </button>
          </div>
        </div>

        {/* Modal: Create Shop */}
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full border border-slate-100 overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
              <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Khởi tạo Shop & Chủ Tài Khoản</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Tài khoản được kích hoạt và xác thực ngay khi khởi tạo
                  </p>
                </div>
                <button
                  onClick={() => setShowCreateModal && setShowCreateModal(false)}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-50"
                >
                  ✕
                </button>
              </div>

              {createdSuccess ? (
                /* Success State */
                <div data-testid="state-success" className="p-6">
                  <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <h4 className="text-center font-bold text-slate-900 text-base mb-1">
                    Cửa hàng đã khởi tạo thành công!
                  </h4>
                  <p className="text-center text-xs text-slate-500 mb-6">
                    Hệ thống đã thiết lập tài khoản và định tuyến mã cửa hàng tự động.
                  </p>

                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/80 space-y-2 text-xs mb-4">
                    <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                      <span className="text-slate-500">Tên cửa hàng:</span>
                      <span className="font-semibold text-slate-800">
                        {createdSuccess.merchant.name}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                      <span className="text-slate-500">Mã định danh (Merchant Code):</span>
                      <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                        {createdSuccess.merchant.code}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                      <span className="text-slate-500">Chủ tài khoản:</span>
                      <span className="font-medium text-slate-800">
                        {createdSuccess.user.full_name}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                      <span className="text-slate-500">Liên hệ:</span>
                      <span className="text-slate-800">
                        {createdSuccess.user.email || createdSuccess.user.phone}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-1">
                      <span className="text-slate-500">Trạng thái:</span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                        {createdSuccess.merchant.status.toUpperCase()} & ĐÃ XÁC THỰC
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

                  <div className="mt-6 flex justify-end">
                    <button
                      onClick={() => setShowCreateModal && setShowCreateModal(false)}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      Đóng
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={onCreateSubmit} className="p-6 space-y-4">
                  {createError && (
                    <div
                      data-testid="state-error"
                      className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg flex items-center gap-2"
                    >
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{createError}</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Tên Cửa hàng (Merchant / Shop Name) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={merchantName}
                      onChange={(e) => setMerchantName && setMerchantName(e.target.value)}
                      placeholder="Ví dụ: GUMAC Flagship Store"
                      className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 ${
                        formErrors.merchant_name
                          ? 'border-red-400 focus:ring-red-200'
                          : 'border-slate-300 focus:ring-indigo-500 focus:border-indigo-500'
                      }`}
                    />
                    {formErrors.merchant_name && (
                      <p data-testid="state-validation" className="text-xs text-red-600 mt-1">
                        {formErrors.merchant_name}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Họ tên chủ shop (Tùy chọn)
                    </label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName && setFullName(e.target.value)}
                      placeholder="Mặc định lấy theo tên cửa hàng"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Email liên hệ
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail && setEmail(e.target.value)}
                        placeholder="owner@domain.vn"
                        className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 ${
                          formErrors.email
                            ? 'border-red-400 focus:ring-red-200'
                            : 'border-slate-300 focus:ring-indigo-500 focus:border-indigo-500'
                        }`}
                      />
                      {formErrors.email && (
                        <p data-testid="state-validation" className="text-xs text-red-600 mt-1">
                          {formErrors.email}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Số điện thoại
                      </label>
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone && setPhone(e.target.value)}
                        placeholder="0987654321"
                        className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 ${
                          formErrors.phone
                            ? 'border-red-400 focus:ring-red-200'
                            : 'border-slate-300 focus:ring-indigo-500 focus:border-indigo-500'
                        }`}
                      />
                      {formErrors.phone && (
                        <p data-testid="state-validation" className="text-xs text-red-600 mt-1">
                          {formErrors.phone}
                        </p>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Mật khẩu khởi tạo (Tùy chọn)
                    </label>
                    <div className="relative">
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword && setPassword(e.target.value)}
                        placeholder="Để trống sẽ gửi liên kết thiết lập một lần"
                        className={`w-full pl-8 pr-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 ${
                          formErrors.password
                            ? 'border-red-400 focus:ring-red-200'
                            : 'border-slate-300 focus:ring-indigo-500 focus:border-indigo-500'
                        }`}
                      />
                      <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    </div>
                    {formErrors.password ? (
                      <p data-testid="state-validation" className="text-xs text-red-600 mt-1">
                        {formErrors.password}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-400 mt-1">
                        Tối thiểu 8 ký tự nếu nhập trực tiếp
                      </p>
                    )}
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setShowCreateModal && setShowCreateModal(false)}
                      className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                      Hủy bỏ
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors disabled:opacity-50"
                    >
                      {isSubmitting && <RefreshCw className="w-4 h-4 animate-spin" />}
                      {isSubmitting ? 'Đang tạo...' : 'Xác nhận tạo Shop'}
                    </button>
                  </div>
                </form>
              )}
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
              onClick={() => onRefresh && onRefresh()}
              className="text-xs font-semibold px-3 py-1.5 bg-red-100 text-red-800 hover:bg-red-200 rounded-md transition-colors"
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
              onChange={(e) => setSearchQuery && setSearchQuery(e.target.value)}
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
              onClick={() => setShowCreateModal && setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              Khởi tạo cửa hàng ngay
            </button>
          </div>
        ) : (
          /* Shop Cards / Table (Success State) */
          <div
            data-testid="state-success"
            className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
          >
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
                      Ngày khởi tạo
                    </th>
                    <th scope="col" className="px-6 py-3.5 text-right">
                      Thao tác
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-700">
                  {shops.map((s) => {
                    const owner = s.users?.find((u) => u.role === 'OWNER') || s.users?.[0];
                    return (
                      <tr key={s.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-6 py-4 font-semibold text-slate-900">{s.name}</td>
                        <td className="px-6 py-4 font-mono font-medium text-indigo-600 text-xs">
                          {s.code}
                        </td>
                        <td className="px-6 py-4">
                          {owner ? (
                            <div>
                              <div className="font-medium text-slate-800">{owner.full_name}</div>
                              <div className="text-xs text-slate-500">
                                {owner.email || owner.phone}
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-400 italic">Chưa gán</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                              s.status === 'active'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}
                          >
                            {s.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-xs text-slate-500">
                          {new Date(s.created_at).toLocaleDateString('vi-VN')}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            disabled
                            title="Tính năng truy cập bảng điều khiển shop dành riêng cho operator"
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-400 bg-slate-100 rounded-md cursor-not-allowed"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Truy cập
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 flex items-center justify-between">
              <span>Hiển thị {shops.length} cửa hàng</span>
              <span className="inline-flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                Hệ sinh thái phân quyền đơn vị
              </span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function AdminShopsPage() {
  const { user, token, isAuthenticated, isHydrating } = useAuth();

  const isPlatformAdmin = Boolean(
    user &&
      (user.role === 'BACKOFFICE' ||
        (user.role as string) === 'PLATFORM_ADMIN' ||
        (user.role as string) === 'ADMIN')
  );

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [shops, setShops] = useState<ShopRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [merchantName, setMerchantName] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdSuccess, setCreatedSuccess] = useState<CreatedShopSuccessData | null>(null);

  const fetchShops = useCallback(async () => {
    setIsLoading(true);
    setListError(null);
    try {
      const res = await fetch(`/api/admin/shops?search=${encodeURIComponent(searchQuery)}`, {
        headers: {
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
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
  }, [searchQuery, token]);

  useEffect(() => {
    if (isAuthenticated && user && isPlatformAdmin) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
      void fetchShops();
    }
  }, [isAuthenticated, user, isPlatformAdmin, fetchShops]);

  const handleCreateShop = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setFormErrors({});

    const errors = validateShopForm(merchantName, email, phone, password);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/admin/shops', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
      setMerchantName('');
      setFullName('');
      setEmail('');
      setPhone('');
      setPassword('');
      setFormErrors({});

      void fetchShops();
    } catch (err: any) {
      setCreateError(err.message || 'Lỗi khi khởi tạo cửa hàng');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AdminShopsView
      isAuthenticated={isAuthenticated}
      user={user}
      isPlatformAdmin={isPlatformAdmin}
      isHydrating={isHydrating}
      shops={shops}
      isLoading={isLoading}
      listError={listError}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      showCreateModal={showCreateModal}
      setShowCreateModal={setShowCreateModal}
      merchantName={merchantName}
      setMerchantName={setMerchantName}
      fullName={fullName}
      setFullName={setFullName}
      email={email}
      setEmail={setEmail}
      phone={phone}
      setPhone={setPhone}
      password={password}
      setPassword={setPassword}
      isSubmitting={isSubmitting}
      formErrors={formErrors}
      createError={createError}
      createdSuccess={createdSuccess}
      onRefresh={fetchShops}
      onCreateSubmit={handleCreateShop}
    />
  );
}
