'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Store,
  User,
  Mail,
  Phone,
  Lock,
  Key,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plus,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

interface FieldErrorMap {
  merchant_name?: string;
  owner_full_name?: string;
  owner_email?: string;
  owner_phone?: string;
  owner_password?: string;
}

interface SubmitResult {
  success: boolean;
  error?: { code: string; message: string; fields?: FieldErrorMap };
  data?: {
    merchant?: { name: string; code: string };
    user?: {
      full_name: string;
      email: string | null;
      phone: string | null;
    };
    temporary_password?: string;
  };
}

export default function CreateShopPage() {
  const { isAuthenticated } = useAuth();
  const [merchantName, setMerchantName] = useState('');
  const [ownerFullName, setOwnerFullName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<FieldErrorMap>({});
  const [submitError, setSubmitError] = useState<{
    code: string;
    message: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  // Never show loading skeleton when not signed in — show forbidden immediately
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <h1 className="text-2xl font-bold text-red-700">403 — Chưa được cấp quyền</h1>
          </div>
          <p className="text-slate-600">
            Bạn cần đăng nhập với tài khoản quản trị nền tảng để truy cập trang này.
          </p>
          <div className="mt-4 text-sm text-slate-400">Liên hệ admin nếu cần hỗ trợ.</div>
        </div>
      </div>
    );
  }

  const clearMessages = () => {
    setFieldErrors({});
    setSubmitError(null);
  };

  const validate = (): boolean => {
    const errors: FieldErrorMap = {};

    if (!merchantName.trim()) {
      errors.merchant_name = 'Vui lòng nhập tên cửa hàng.';
    } else if (merchantName.trim().length < 2) {
      errors.merchant_name = 'Tên cửa hàng phải có ít nhất 2 ký tự.';
    } else if (merchantName.trim().length > 255) {
      errors.merchant_name = 'Tên cửa hàng không được vượt quá 255 ký tự.';
    }

    if (!ownerFullName.trim()) {
      errors.owner_full_name = 'Vui lòng nhập họ và tên.';
    } else if (ownerFullName.trim().length < 2) {
      errors.owner_full_name = 'Họ và tên phải có ít nhất 2 ký tự.';
    }

    if (!ownerEmail && !ownerPhone) {
      errors.owner_email = 'Vui lòng cung cấp ít nhất email hoặc số điện thoại cho chủ cửa hàng.';
    }

    if (ownerPassword && (ownerPassword.length < 8 || ownerPassword.length > 128)) {
      errors.owner_password = 'Mật khẩu phải có từ 8 đến 128 ký tự.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();
    setResult(null);

    if (!validate()) return;

    setIsSubmitting(true);

    const payload: Record<string, string> = {
      merchant_name: merchantName.trim(),
      owner_full_name: ownerFullName.trim(),
    };
    if (ownerEmail.trim()) payload.owner_email = ownerEmail.trim();
    if (ownerPhone.trim()) payload.owner_phone = ownerPhone.trim();
    if (ownerPassword) payload.owner_password = ownerPassword;

    try {
      const res = await fetch('/api/admin/shops/owner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        const code = body?.error?.code || 'UNKNOWN_ERROR';
        const message = body?.error?.message || 'Không thể tạo cửa hàng. Vui lòng thử lại.';

        if (code === 'VALIDATION_ERROR' && body?.error?.fields) {
          const fieldErr: FieldErrorMap = {};
          for (const field of body.error.fields as Array<{
            field: string;
            message: string;
          }>) {
            fieldErr[field.field as keyof FieldErrorMap] = field.message;
          }
          setFieldErrors(fieldErr);
          setSubmitError({ code, message });
        } else {
          setSubmitError({ code, message });
        }
        setIsSubmitting(false);
        return;
      }

      setResult({
        success: true,
        data: {
          merchant: body?.data?.merchant || {
            name: merchantName,
            code: '',
          },
          user: body?.data?.user
            ? {
                full_name: body.data.user.full_name,
                email: body.data.user.email,
                phone: body.data.user.phone,
              }
            : undefined,
          temporary_password: body?.data?.temporary_password,
        },
      });
    } catch {
      setSubmitError({
        code: 'NETWORK_ERROR',
        message: 'Không thể kết nối đến máy chủ. Vui lòng thử lại.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---- 403 Forbidden (admin key not configured) -----------------------

  if (submitError?.code === 'FORBIDDEN') {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-3xl mx-auto">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 mb-4 text-xs text-slate-500">
            <Link href="/admin/shops">
              <span className="hover:text-slate-900 cursor-pointer">Cửa Hàng</span>
            </Link>
            <span>/</span>
            <span>Tạo Cửa Hàng</span>
          </div>

          <div className="modern-card p-8 text-center">
            <div className="w-14 h-14 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 mb-2">Truy cập bị từ chối</h2>
            <p className="text-sm text-slate-600 mb-4">{submitError.message}</p>
            <p className="text-xs text-slate-500">
              Liên hệ với quản trị viên nền tảng để cấu hình
              <code className="mx-1 px-2 py-1 bg-slate-100 rounded text-slate-700">
                PLATFORM_ADMIN_KEY
              </code>
              trên máy chủ.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ---- Success state --------------------------------------------------

  if (result?.success) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-3xl mx-auto">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 mb-4 text-xs text-slate-500">
            <Link href="/admin/shops">
              <span className="hover:text-slate-900 cursor-pointer">Cửa Hàng</span>
            </Link>
            <span>/</span>
            <span>Tạo Cửa Hàng</span>
          </div>

          <div className="modern-card p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Cửa hàng đã được tạo thành công
                </h2>
                <p className="text-xs text-slate-500">
                  {result.data?.merchant?.name || merchantName} — Mã:{' '}
                  <code className="font-mono">{result.data?.merchant?.code || '—'}</code>
                </p>
              </div>
            </div>

            <div className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Chủ cửa hàng
                </label>
                <p className="text-slate-900 font-medium">
                  {result.data?.user?.full_name || ownerFullName}
                </p>
              </div>

              {(result.data?.user?.email || ownerEmail) && (
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Email</label>
                  <p className="text-slate-900">{result.data?.user?.email || ownerEmail}</p>
                </div>
              )}

              {(result.data?.user?.phone || ownerPhone) && (
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Điện thoại
                  </label>
                  <p className="text-slate-900">{result.data?.user?.phone || ownerPhone}</p>
                </div>
              )}

              {result.data?.temporary_password && (
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Mật khẩu tạm thời (chưa mật khẩu này an toàn)
                  </label>
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-xs bg-slate-100 px-2 py-1 rounded">
                      {result.data.temporary_password}
                    </code>
                  </div>
                </div>
              )}

              {!result.data?.temporary_password && !ownerPassword && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xs text-amber-800">
                    Người dùng sẽ nhận được mật khẩu tạm thời qua kênh đã đăng ký. Hãy chia sẻ mật
                    khẩu này một cách bảo mật.
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 mt-6 pt-6 border-t border-slate-100">
              <Link href="/admin/shops">
                <button type="button" className="btn-primary text-xs py-1.5 px-3">
                  Xem Danh Sách Cửa Hàng
                </button>
              </Link>
              <button
                type="button"
                onClick={() => {
                  setMerchantName('');
                  setOwnerFullName('');
                  setOwnerEmail('');
                  setOwnerPhone('');
                  setOwnerPassword('');
                  setShowPassword(false);
                  setResult(null);
                }}
                className="text-xs py-1.5 px-3 text-slate-600 hover:bg-slate-100 rounded"
              >
                Tạo cửa hàng khác
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---- Form -----------------------------------------------------------

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-3xl mx-auto">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 mb-4 text-xs text-slate-500">
          <Link href="/admin/shops">
            <span className="hover:text-slate-900 cursor-pointer">Cửa Hàng</span>
          </Link>
          <span>/</span>
          <span className="text-slate-900">Tạo Cửa Hàng</span>
        </nav>

        <div className="flex items-center gap-3 mb-5">
          <Store className="w-5 h-5 text-slate-700" />
          <h1 className="text-xl font-bold text-slate-900">Tạo Cửa Hàng Mới</h1>
        </div>

        {/* Submit Error (non-field) */}
        {submitError && submitError.code !== 'FORBIDDEN' && !result && (
          <div className="mb-4 modern-card border border-rose-200 bg-rose-50 p-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-medium text-rose-800 mb-1">{submitError.message}</p>
              </div>
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Merchant Name */}
          <div className="modern-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Store className="w-3.5 h-3.5 text-slate-600" />
              <label htmlFor="merchant_name" className="block text-xs font-medium text-slate-700">
                Tên Cửa Hàng <span className="text-rose-500">*</span>
              </label>
            </div>
            <input
              id="merchant_name"
              type="text"
              value={merchantName}
              onChange={(e) => {
                setMerchantName(e.target.value);
                if (fieldErrors.merchant_name) {
                  setFieldErrors((prev) => ({
                    ...prev,
                    merchant_name: undefined,
                  }));
                }
                if (submitError) setSubmitError(null);
              }}
              placeholder="Nhập tên cửa hàng"
              maxLength={255}
              className={`modern-input text-xs py-1.5 px-3 w-full ${
                fieldErrors.merchant_name ? 'border-rose-300' : ''
              }`}
            />
            {fieldErrors.merchant_name && (
              <p className="text-xs text-rose-600 mt-1.5">{fieldErrors.merchant_name}</p>
            )}
          </div>

          {/* Owner Full Name */}
          <div className="modern-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <User className="w-3.5 h-3.5 text-slate-600" />
              <label htmlFor="owner_full_name" className="block text-xs font-medium text-slate-700">
                Họ Và Tên Chủ Cửa Hàng <span className="text-rose-500">*</span>
              </label>
            </div>
            <input
              id="owner_full_name"
              type="text"
              value={ownerFullName}
              onChange={(e) => {
                setOwnerFullName(e.target.value);
                if (fieldErrors.owner_full_name) {
                  setFieldErrors((prev) => ({
                    ...prev,
                    owner_full_name: undefined,
                  }));
                }
                if (submitError) setSubmitError(null);
              }}
              placeholder="Nguyễn Văn A"
              maxLength={255}
              className={`modern-input text-xs py-1.5 px-3 w-full ${
                fieldErrors.owner_full_name ? 'border-rose-300' : ''
              }`}
            />
            {fieldErrors.owner_full_name && (
              <p className="text-xs text-rose-600 mt-1.5">{fieldErrors.owner_full_name}</p>
            )}
          </div>

          {/* Owner Email */}
          <div className="modern-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Mail className="w-3.5 h-3.5 text-slate-600" />
              <label htmlFor="owner_email" className="block text-xs font-medium text-slate-700">
                Email Chủ Cửa Hàng
              </label>
            </div>
            <input
              id="owner_email"
              type="email"
              value={ownerEmail}
              onChange={(e) => {
                setOwnerEmail(e.target.value);
                if (fieldErrors.owner_email) {
                  setFieldErrors((prev) => ({
                    ...prev,
                    owner_email: undefined,
                  }));
                }
                if (submitError) setSubmitError(null);
              }}
              placeholder="owner@example.com"
              maxLength={255}
              className={`modern-input text-xs py-1.5 px-3 w-full ${
                fieldErrors.owner_email ? 'border-rose-300' : ''
              }`}
            />
            {fieldErrors.owner_email && (
              <p className="text-xs text-rose-600 mt-1.5">{fieldErrors.owner_email}</p>
            )}
            {fieldErrors.owner_email && (
              <p className="text-xs text-slate-400 mt-1">
                Cung cấp email hoặc số điện thoại để nhận mật khẩu tạm thời.
              </p>
            )}
          </div>

          {/* Owner Phone */}
          <div className="modern-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Phone className="w-3.5 h-3.5 text-slate-600" />
              <label htmlFor="owner_phone" className="block text-xs font-medium text-slate-700">
                Số Điện Thoại Chủ Cửa Hàng
              </label>
            </div>
            <input
              id="owner_phone"
              type="tel"
              value={ownerPhone}
              onChange={(e) => {
                setOwnerPhone(e.target.value);
                if (fieldErrors.owner_phone) {
                  setFieldErrors((prev) => ({
                    ...prev,
                    owner_phone: undefined,
                  }));
                }
                if (submitError) setSubmitError(null);
              }}
              placeholder="0901234567"
              maxLength={20}
              className={`modern-input text-xs py-1.5 px-3 w-full ${
                fieldErrors.owner_phone ? 'border-rose-300' : ''
              }`}
            />
            {fieldErrors.owner_phone && (
              <p className="text-xs text-rose-600 mt-1.5">{fieldErrors.owner_phone}</p>
            )}
          </div>

          {/* Owner Password */}
          <div className="modern-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Lock className="w-3.5 h-3.5 text-slate-600" />
              <label htmlFor="owner_password" className="block text-xs font-medium text-slate-700">
                Mật Khẩu (Tùy chọn)
              </label>
            </div>
            <div className="relative">
              <input
                id="owner_password"
                type={showPassword ? 'text' : 'password'}
                value={ownerPassword}
                onChange={(e) => {
                  setOwnerPassword(e.target.value);
                  if (fieldErrors.owner_password) {
                    setFieldErrors((prev) => ({
                      ...prev,
                      owner_password: undefined,
                    }));
                  }
                }}
                placeholder="Để trống để hệ thống tạo mật khẩu tự động"
                maxLength={128}
                minLength={8}
                className={`modern-input text-xs py-1.5 px-3 w-full pr-9 ${
                  fieldErrors.owner_password ? 'border-rose-300' : ''
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              >
                <Key className="w-3.5 h-3.5" />
              </button>
            </div>
            {fieldErrors.owner_password && (
              <p className="text-xs text-rose-600 mt-1.5">{fieldErrors.owner_password}</p>
            )}
            <p className="text-xs text-slate-400 mt-1.5">
              Để trống để hệ thống tạo mật khẩu tạm thời và gửi qua email hoặc SMS.
            </p>
          </div>

          {/* Form Actions */}
          <div className="modern-card p-4 border-t border-slate-100">
            <div className="flex items-center justify-end gap-3">
              <Link href="/admin/shops">
                <button
                  type="button"
                  disabled={isSubmitting}
                  className="text-xs py-1.5 px-3 text-slate-600 hover:bg-slate-100 rounded transition-colors"
                >
                  Hủy
                </button>
              </Link>
              <button
                type="submit"
                disabled={isSubmitting}
                className="btn-primary text-xs py-1.5 px-4 flex items-center gap-1.5 disabled:opacity-70"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Đang xử lý...
                  </>
                ) : (
                  <>
                    <Plus className="w-3.5 h-3.5" />
                    Tạo Cửa Hàng
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
