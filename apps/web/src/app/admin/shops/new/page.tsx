'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import {
  Store,
  ArrowLeft,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Key,
  Copy,
  Check,
  RefreshCw,
  ArrowRight,
} from 'lucide-react';
import { CreatedShopSuccessData } from '../page';

export default function AdminNewShopPage() {
  const router = useRouter();
  const { user, isAuthenticated, isHydrating } = useAuth();

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

  // AC-ADMIN-15: Signed-out users access admin routes must reach forbidden state immediately
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
            Bạn cần đăng nhập với quyền Quản trị viên (Operator) để khởi tạo cửa hàng trên hệ thống.
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
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/admin/shops"
              className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Danh sách cửa hàng
            </Link>
          </div>
          <span className="text-xs font-medium px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full border border-indigo-200">
            Admin Provisioning
          </span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 pt-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Khởi tạo cửa hàng mới
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Thiết lập tài khoản cửa hàng và chủ sở hữu được kích hoạt và xác thực sẵn.
          </p>
        </div>

        {/* Success State */}
        {createdSuccess ? (
          <div
            data-testid="state-success"
            className="bg-white rounded-2xl border border-emerald-200 shadow-lg p-8"
          >
            <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 text-center mb-1">
              Khởi tạo cửa hàng thành công!
            </h2>
            <p className="text-sm text-slate-500 text-center mb-6">
              Cửa hàng{' '}
              <span className="font-semibold text-slate-800">{createdSuccess.merchant.name}</span>{' '}
              đã được ghi nhận trên cơ sở dữ liệu.
            </p>

            <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-sm mb-6">
              <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                <span className="text-slate-500">Mã cửa hàng:</span>
                <span className="font-mono font-bold text-indigo-600">
                  {createdSuccess.merchant.code}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                <span className="text-slate-500">Chủ sở hữu:</span>
                <span className="font-medium text-slate-800">{createdSuccess.user.full_name}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                <span className="text-slate-500">Thông tin liên hệ:</span>
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

            {createdSuccess.password_is_temporary && createdSuccess.temporary_password && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <Key className="w-5 h-5 text-amber-600" />
                  <span className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                    Mật khẩu đăng nhập tạm thời
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 bg-white p-3 rounded-lg border border-amber-200">
                  <code className="text-base font-mono font-bold text-amber-950">
                    {createdSuccess.temporary_password}
                  </code>
                  <button
                    onClick={() => copyTemporaryPassword(createdSuccess.temporary_password!)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-amber-100 hover:bg-amber-200 text-amber-900 rounded-md transition-colors"
                  >
                    {copiedPass ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        Đã chép
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Sao chép
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <Link
                href="/admin/shops"
                className="w-full text-center py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-colors text-sm shadow-sm"
              >
                Quay về danh sách cửa hàng
              </Link>
            </div>
          </div>
        ) : (
          /* Create Form */
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8">
            <form onSubmit={handleCreateShop} className="space-y-5">
              {createError && (
                <div
                  data-testid="state-error"
                  className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
                    <span>{createError}</span>
                  </div>
                  <button
                    type="submit"
                    className="px-2.5 py-1 bg-white border border-red-300 rounded text-red-700 font-medium hover:bg-red-50"
                  >
                    Thử lại
                  </button>
                </div>
              )}

              {Object.keys(formErrors).length > 0 && (
                <div
                  data-testid="state-validation"
                  className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800"
                >
                  <p className="font-semibold mb-1">Vui lòng kiểm tra lại thông tin:</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    {Object.values(formErrors).map((msg, idx) => (
                      <li key={idx}>{msg}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Tên cửa hàng <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={merchantName}
                  onChange={(e) => setMerchantName(e.target.value)}
                  placeholder="VD: Cửa hàng Thời Trang An An"
                  className={`w-full px-4 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    formErrors.merchant_name ? 'border-red-300 bg-red-50/20' : 'border-slate-300'
                  }`}
                />
                {formErrors.merchant_name && (
                  <p className="text-xs text-red-600 mt-1">{formErrors.merchant_name}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Họ và tên chủ cửa hàng
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="VD: Nguyễn Văn An"
                  className="w-full px-4 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Địa chỉ Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@ananboutique.vn"
                  className={`w-full px-4 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    formErrors.email ? 'border-red-300 bg-red-50/20' : 'border-slate-300'
                  }`}
                />
                {formErrors.email && (
                  <p className="text-xs text-red-600 mt-1">{formErrors.email}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Số điện thoại
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0901234567"
                  className={`w-full px-4 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    formErrors.phone ? 'border-red-300 bg-red-50/20' : 'border-slate-300'
                  }`}
                />
                {formErrors.phone && (
                  <p className="text-xs text-red-600 mt-1">{formErrors.phone}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Mật khẩu tùy chọn
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Để trống để sinh mật khẩu ngẫu nhiên"
                  className={`w-full px-4 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    formErrors.password ? 'border-red-300 bg-red-50/20' : 'border-slate-300'
                  }`}
                />
                {formErrors.password && (
                  <p className="text-xs text-red-600 mt-1">{formErrors.password}</p>
                )}
                <p className="text-2xs text-slate-400 mt-1">
                  Nếu để trống, hệ thống sẽ tự động tạo mật khẩu an toàn và cung cấp cho quản trị
                  viên sau khi tạo thành công.
                </p>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
                <Link
                  href="/admin/shops"
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Hủy
                </Link>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm shadow-indigo-200 transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Đang xử lý...
                    </>
                  ) : (
                    'Khởi tạo cửa hàng'
                  )}
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
