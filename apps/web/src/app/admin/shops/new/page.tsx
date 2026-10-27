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
  RefreshCw,
  ArrowRight,
} from 'lucide-react';
import { CreatedShopSuccessData, validateShopForm } from '../page';

export interface AdminNewShopViewProps {
  isAuthenticated: boolean;
  user: any;
  isPlatformAdmin: boolean;
  isHydrating: boolean;
  merchantName: string;
  setMerchantName?: (v: string) => void;
  fullName: string;
  setFullName?: (v: string) => void;
  email: string;
  setEmail?: (v: string) => void;
  phone: string;
  setPhone?: (v: string) => void;
  password: string;
  setPassword?: (v: string) => void;
  isSubmitting: boolean;
  formErrors: Record<string, string>;
  createError: string | null;
  createdSuccess: CreatedShopSuccessData | null;
  onSubmit?: (e: React.FormEvent) => void;
}

export function AdminNewShopView({
  isAuthenticated,
  user,
  isPlatformAdmin,
  isHydrating,
  merchantName,
  setMerchantName,
  fullName,
  setFullName,
  email,
  setEmail,
  phone,
  setPhone,
  password,
  setPassword,
  isSubmitting,
  formErrors,
  createError,
  createdSuccess,
  onSubmit,
}: AdminNewShopViewProps) {
  // AC-ADMIN-15: Signed-out or unauthorized users access admin routes must reach forbidden state immediately
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

            {createdSuccess.password_is_temporary && (
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <Key className="w-5 h-5 text-blue-600" />
                  <span className="text-xs font-bold text-blue-900 uppercase tracking-wider">
                    Thiết lập mật khẩu lần đầu
                  </span>
                </div>
                <p className="text-xs text-blue-800 leading-relaxed">
                  Liên kết thiết lập mật khẩu bảo mật một lần đã được gửi đến{' '}
                  <strong className="font-semibold text-blue-950">
                    {createdSuccess.user.email || createdSuccess.user.phone}
                  </strong>
                  . Chủ cửa hàng có thể sử dụng liên kết này để hoàn tất thiết lập mật khẩu ban đầu.
                </p>
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
            <form onSubmit={onSubmit} className="space-y-5">
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
                  onChange={(e) => setMerchantName && setMerchantName(e.target.value)}
                  placeholder="VD: Cửa hàng Thời Trang An An"
                  className={`w-full px-4 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    formErrors.merchant_name ? 'border-red-300 bg-red-50/20' : 'border-slate-300'
                  }`}
                />
                {formErrors.merchant_name && (
                  <p data-testid="state-validation" className="text-xs text-red-600 mt-1">
                    {formErrors.merchant_name}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Họ và tên chủ cửa hàng (Tùy chọn)
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName && setFullName(e.target.value)}
                  placeholder="Để trống sẽ mặc định lấy theo Tên cửa hàng"
                  className="w-full px-4 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Email liên hệ
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail && setEmail(e.target.value)}
                    placeholder="VD: chu_shop@domain.vn"
                    className={`w-full px-4 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                      formErrors.email ? 'border-red-300 bg-red-50/20' : 'border-slate-300'
                    }`}
                  />
                  {formErrors.email && (
                    <p data-testid="state-validation" className="text-xs text-red-600 mt-1">
                      {formErrors.email}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Số điện thoại
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone && setPhone(e.target.value)}
                    placeholder="VD: 0987654321"
                    className={`w-full px-4 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                      formErrors.phone ? 'border-red-300 bg-red-50/20' : 'border-slate-300'
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
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Mật khẩu khởi tạo (Tùy chọn)
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword && setPassword(e.target.value)}
                  placeholder="Để trống sẽ gửi liên kết thiết lập một lần"
                  className={`w-full px-4 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    formErrors.password ? 'border-red-300 bg-red-50/20' : 'border-slate-300'
                  }`}
                />
                {formErrors.password && (
                  <p data-testid="state-validation" className="text-xs text-red-600 mt-1">
                    {formErrors.password}
                  </p>
                )}
                <span className="text-xs text-slate-400 mt-1 block">
                  Tối thiểu 8 ký tự nếu nhập trực tiếp
                </span>
              </div>

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                <Link
                  href="/admin/shops"
                  className="px-5 py-2.5 text-sm font-semibold text-slate-600 hover:text-slate-800 transition-colors"
                >
                  Hủy bỏ
                </Link>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-all shadow-sm hover:shadow disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Đang xử lý...
                    </>
                  ) : (
                    <>
                      <Store className="w-4 h-4" />
                      Khởi tạo ngay
                    </>
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

export default function AdminNewShopPage() {
  const router = useRouter();
  const { user, token, isAuthenticated, isHydrating } = useAuth();

  const isPlatformAdmin = Boolean(
    user &&
    ((user.role as string) === 'BACKOFFICE' ||
      (user.role as string) === 'PLATFORM_ADMIN' ||
      (user.role as string) === 'ADMIN')
  );

  const [merchantName, setMerchantName] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdSuccess, setCreatedSuccess] = useState<CreatedShopSuccessData | null>(null);

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
    } catch (err: any) {
      setCreateError(err.message || 'Lỗi khi khởi tạo cửa hàng');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AdminNewShopView
      isAuthenticated={isAuthenticated}
      user={user}
      isPlatformAdmin={isPlatformAdmin}
      isHydrating={isHydrating}
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
      onSubmit={handleCreateShop}
    />
  );
}
