'use client';

import React, { useState, useEffect, Suspense, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  Lock,
  User,
  Shield,
  Building2,
  Store,
  Warehouse,
  ArrowRight,
  Eye,
  EyeOff,
} from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface InvitationDetails {
  valid: boolean;
  tenant_name: string;
  role: string;
  identifier: string;
  store_scopes?: string[];
  warehouse_scopes?: string[];
}

function AcceptInvitationContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');

  const [verifying, setVerifying] = useState(true);
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Form state
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);

  const verifyToken = useCallback(async (tok: string) => {
    setVerifying(true);
    setVerifyError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/invitations/verify?token=${encodeURIComponent(tok)}`
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Liên kết lời mời không hợp lệ hoặc đã hết hạn.');
      }
      setInvitation(data.data);
    } catch (err: any) {
      setVerifyError(err.message || 'Liên kết lời mời không hợp lệ hoặc đã hết hạn.');
    } finally {
      setVerifying(false);
    }
  }, []);

  useEffect(() => {
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Client-side invitation token verification initialization
      setVerifying(false);
      setVerifyError(
        'Mã lời mời không tồn tại trong đường dẫn. Vui lòng kiểm tra lại liên kết trong email hoặc tin nhắn của bạn.'
      );
      return;
    }
    void verifyToken(token);
  }, [token, verifyToken]);

  // Password rules helper
  const rules = {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    digit: /[0-9]/.test(password),
    special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
    match: Boolean(password && password === passwordConfirm),
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setSubmitting(true);
    setSubmitError(null);
    setFieldErrors({});

    const clientErrors: Record<string, string> = {};
    if (!fullName.trim()) {
      clientErrors.full_name = 'Vui lòng nhập họ và tên của bạn';
    }
    if (!rules.length || !rules.upper || !rules.lower || !rules.digit || !rules.special) {
      clientErrors.password = 'Mật khẩu chưa đáp ứng đủ các tiêu chuẩn bảo mật';
    }
    if (password !== passwordConfirm) {
      clientErrors.password_confirm = 'Mật khẩu xác nhận không trùng khớp';
    }

    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/v1/invitations/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          full_name: fullName.trim(),
          password,
          password_confirm: passwordConfirm,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.error?.fields && Array.isArray(data.error.fields)) {
          const mapped: Record<string, string> = {};
          for (const f of data.error.fields) {
            mapped[f.field] = f.message;
          }
          setFieldErrors(mapped);
        }
        throw new Error(data.error?.message || 'Không thể kích hoạt tài khoản. Vui lòng thử lại.');
      }

      setSuccess(true);
    } catch (err: any) {
      setSubmitError(err.message || 'Lỗi kết nối máy chủ');
    } finally {
      setSubmitting(false);
    }
  };

  const getRoleLabel = (r: string) => {
    switch (r) {
      case 'OWNER':
        return 'Chủ Cửa Hàng (OWNER)';
      case 'OPS_CSKH':
        return 'Vận Hành & CSKH (OPS_CSKH)';
      case 'WAREHOUSE':
        return 'Quản Lý Kho Hàng (WAREHOUSE)';
      case 'ACCOUNTANT':
        return 'Kế Toán & Đối Soát (ACCOUNTANT)';
      default:
        return r;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-blue-600 text-white shadow-lg mb-4">
          <Shield className="w-6 h-6" />
        </div>
        <h2 className="text-2xl font-black text-slate-900 tracking-tight">Ship Dễ Platform</h2>
        <p className="mt-1 text-xs text-slate-500 font-medium">
          Nền tảng vận hành & kiểm soát vận chuyển cho Shop Online
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 shadow-xl rounded-2xl border border-slate-200 sm:px-10">
          {verifying ? (
            <div className="py-12 text-center space-y-3">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto" />
              <p className="text-sm font-semibold text-slate-700">
                Đang xác thực liên kết lời mời...
              </p>
              <p className="text-xs text-slate-400">Vui lòng chờ trong giây lát</p>
            </div>
          ) : verifyError ? (
            <div className="text-center py-6 space-y-4">
              <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">
                  Liên Kết Không Hợp Lệ Hoặc Đã Hết Hạn
                </h3>
                <p className="text-xs text-slate-600 mt-2 leading-relaxed">{verifyError}</p>
              </div>
              <div className="pt-4 border-t border-slate-100 flex flex-col gap-2">
                <Link
                  href="/"
                  className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <span>Quay về trang đăng nhập</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          ) : success ? (
            <div className="text-center py-6 space-y-4 animate-in fade-in">
              <div className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto shadow-sm">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div>
                <h3 className="font-black text-lg text-slate-900">
                  Kích Hoạt Tài Khoản Thành Công!
                </h3>
                <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                  Chào mừng <strong>{fullName}</strong> đã gia nhập đội ngũ{' '}
                  <strong>{invitation?.tenant_name}</strong>. Bạn có thể đăng nhập ngay với mật khẩu
                  vừa tạo.
                </p>
              </div>
              <div className="pt-4 border-t border-slate-100">
                <Link
                  href="/"
                  className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <span>Đăng Nhập Ngay</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          ) : invitation ? (
            <div className="space-y-5">
              {/* Invitation Overview */}
              <div className="p-4 bg-blue-50/60 border border-blue-100 rounded-xl space-y-2">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-blue-600 shrink-0" />
                  <span className="text-xs font-bold text-slate-800">
                    Cửa hàng: {invitation.tenant_name}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <User className="w-4 h-4 text-slate-500 shrink-0" />
                  <span>
                    Tài khoản: <strong>{invitation.identifier}</strong>
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <Shield className="w-4 h-4 text-slate-500 shrink-0" />
                  <span>
                    Vai trò:{' '}
                    <strong className="text-blue-700">{getRoleLabel(invitation.role)}</strong>
                  </span>
                </div>

                {(invitation.store_scopes && invitation.store_scopes.length > 0) ||
                (invitation.warehouse_scopes && invitation.warehouse_scopes.length > 0) ? (
                  <div className="pt-2 border-t border-blue-200/50 text-[11px] space-y-1">
                    {invitation.store_scopes && invitation.store_scopes.length > 0 && (
                      <div className="flex items-center gap-1 text-slate-600">
                        <Store className="w-3 h-3 text-slate-400" />
                        <span>Chi nhánh: {invitation.store_scopes.join(', ')}</span>
                      </div>
                    )}
                    {invitation.warehouse_scopes && invitation.warehouse_scopes.length > 0 && (
                      <div className="flex items-center gap-1 text-slate-600">
                        <Warehouse className="w-3 h-3 text-slate-400" />
                        <span>Kho hàng: {invitation.warehouse_scopes.join(', ')}</span>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              {submitError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="flex-1 font-medium">{submitError}</div>
                  <button
                    type="button"
                    onClick={() => setSubmitError(null)}
                    className="font-bold text-red-500 hover:text-red-700"
                  >
                    ✕
                  </button>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4 text-xs">
                <div>
                  <label htmlFor="accept-name" className="font-bold text-slate-700 block mb-1">
                    Họ và Tên Của Bạn:
                  </label>
                  <input
                    id="accept-name"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Nguyễn Văn A"
                    disabled={submitting}
                    className={`w-full px-3 py-2 border rounded-xl outline-none transition ${
                      fieldErrors.full_name
                        ? 'border-red-400 focus:ring-1 focus:ring-red-500'
                        : 'border-slate-200 focus:border-blue-500'
                    }`}
                  />
                  {fieldErrors.full_name && (
                    <p className="text-red-500 text-[11px] mt-1">{fieldErrors.full_name}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="accept-password" className="font-bold text-slate-700 block mb-1">
                    Thiết Lập Mật Khẩu:
                  </label>
                  <div className="relative">
                    <input
                      id="accept-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      disabled={submitting}
                      className={`w-full px-3 py-2 border rounded-xl outline-none pr-9 transition ${
                        fieldErrors.password
                          ? 'border-red-400 focus:ring-1 focus:ring-red-500'
                          : 'border-slate-200 focus:border-blue-500'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiển thị mật khẩu'}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {fieldErrors.password && (
                    <p className="text-red-500 text-[11px] mt-1">{fieldErrors.password}</p>
                  )}

                  {/* Password checklist */}
                  <div className="mt-2 p-2.5 bg-slate-50 border border-slate-100 rounded-lg space-y-1 text-[11px]">
                    <div className="font-semibold text-slate-600 mb-1">
                      Tiêu chuẩn mật khẩu an toàn:
                    </div>
                    <div
                      className={`flex items-center gap-1.5 ${rules.length ? 'text-emerald-600 font-semibold' : 'text-slate-400'}`}
                    >
                      <span>{rules.length ? '✓' : '○'}</span> Tối thiểu 8 ký tự
                    </div>
                    <div
                      className={`flex items-center gap-1.5 ${rules.upper ? 'text-emerald-600 font-semibold' : 'text-slate-400'}`}
                    >
                      <span>{rules.upper ? '✓' : '○'}</span> Chứa ít nhất 1 chữ in hoa (A-Z)
                    </div>
                    <div
                      className={`flex items-center gap-1.5 ${rules.lower ? 'text-emerald-600 font-semibold' : 'text-slate-400'}`}
                    >
                      <span>{rules.lower ? '✓' : '○'}</span> Chứa ít nhất 1 chữ in thường (a-z)
                    </div>
                    <div
                      className={`flex items-center gap-1.5 ${rules.digit ? 'text-emerald-600 font-semibold' : 'text-slate-400'}`}
                    >
                      <span>{rules.digit ? '✓' : '○'}</span> Chứa ít nhất 1 chữ số (0-9)
                    </div>
                    <div
                      className={`flex items-center gap-1.5 ${rules.special ? 'text-emerald-600 font-semibold' : 'text-slate-400'}`}
                    >
                      <span>{rules.special ? '✓' : '○'}</span> Chứa ít nhất 1 ký tự đặc biệt
                      (!@#$%...)
                    </div>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="accept-password-confirm"
                    className="font-bold text-slate-700 block mb-1"
                  >
                    Nhập Lại Mật Khẩu:
                  </label>
                  <input
                    id="accept-password-confirm"
                    type={showPassword ? 'text' : 'password'}
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    placeholder="••••••••••••"
                    disabled={submitting}
                    className={`w-full px-3 py-2 border rounded-xl outline-none transition ${
                      fieldErrors.password_confirm
                        ? 'border-red-400 focus:ring-1 focus:ring-red-500'
                        : 'border-slate-200 focus:border-blue-500'
                    }`}
                  />
                  {fieldErrors.password_confirm && (
                    <p className="text-red-500 text-[11px] mt-1">{fieldErrors.password_confirm}</p>
                  )}
                  {passwordConfirm && rules.match && (
                    <p className="text-emerald-600 text-[11px] mt-1 flex items-center gap-1">
                      <span>✓</span> Mật khẩu xác nhận khớp
                    </p>
                  )}
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-md transition disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                    <span>
                      {submitting ? 'Đang kích hoạt...' : 'Kích Hoạt Tài Khoản & Bắt Đầu'}
                    </span>
                  </button>
                </div>
              </form>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AcceptInvitationFallback() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
        <span>Đang kiểm tra liên kết lời mời...</span>
      </div>
    </div>
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense fallback={<AcceptInvitationFallback />}>
      <AcceptInvitationContent />
    </Suspense>
  );
}
