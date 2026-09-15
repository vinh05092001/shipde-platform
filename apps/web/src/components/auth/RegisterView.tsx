'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  ShieldCheck,
  Store,
  Phone,
  Mail,
  Lock,
  ArrowRight,
  User,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RefreshCw,
  KeyRound,
} from 'lucide-react';

interface Props {
  onSwitchToLogin: () => void;
}

type RegistrationStep = 'FORM' | 'PENDING_VERIFICATION' | 'VERIFIED_SUCCESS';

export const RegisterView: React.FC<Props> = ({ onSwitchToLogin }) => {
  const { register, verifyEmail, verifyPhone, resendVerification } = useAuth();

  // Form State
  const [merchantName, setMerchantName] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Status & Error States
  const [step, setStep] = useState<RegistrationStep>('FORM');
  const [loading, setLoading] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [rateLimitMessage, setRateLimitMessage] = useState<string | null>(null);
  const [duplicateIdentifier, setDuplicateIdentifier] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Verification Step States
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [registeredPhone, setRegisteredPhone] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  // Countdown timer for resend cooldown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Dirty form warning
  const isDirty =
    Boolean(merchantName || fullName || email || phone || password) && step === 'FORM';

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);
    setRateLimitMessage(null);
    setDuplicateIdentifier(null);
    setFieldErrors({});

    if (!termsAccepted) {
      setFieldErrors({
        terms_accepted: 'Vui lòng đồng ý với Điều khoản dịch vụ và Chính sách bảo mật.',
      });
      return;
    }

    setLoading(true);

    const res = await register({
      merchantName: merchantName.trim(),
      fullName: fullName.trim(),
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      password,
      termsAccepted: true,
      termsVersion: '2026.1',
    });

    setLoading(false);

    if (!res.success) {
      if (res.code === 'RATE_LIMITED') {
        setRateLimitMessage(
          res.nextAction ||
            res.error ||
            'Quá nhiều yêu cầu đăng ký từ địa chỉ của bạn. Vui lòng thử lại sau.'
        );
      } else if (
        res.fields?.some((f) => f.code === 'DUPLICATE') ||
        res.error?.includes('đã được đăng ký')
      ) {
        const dupField = res.fields?.find((f) => f.code === 'DUPLICATE')?.field || 'thông tin';
        setDuplicateIdentifier(
          dupField === 'email'
            ? 'Email này đã được đăng ký tài khoản.'
            : 'Số điện thoại này đã được đăng ký tài khoản.'
        );
      } else if (res.fields && res.fields.length > 0) {
        const errMap: Record<string, string> = {};
        res.fields.forEach((f) => {
          errMap[f.field] = f.message;
        });
        setFieldErrors(errMap);
      } else {
        setGeneralError(res.error || 'Đăng ký thất bại. Vui lòng kiểm tra lại thông tin.');
      }
      return;
    }

    // Success -> Transition to verification pending screen
    setRegisteredEmail(res.data?.email || email);
    setRegisteredPhone(res.data?.phone || phone);
    setResendCooldown(60);
    setStep('PENDING_VERIFICATION');
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verificationCode.trim()) {
      setVerifyError('Vui lòng nhập mã xác thực');
      return;
    }

    setVerifyLoading(true);
    setVerifyError(null);

    let res: { success: boolean; error?: string; code?: string; nextAction?: string };

    if (registeredPhone && /^\d{6}$/.test(verificationCode.trim())) {
      res = await verifyPhone(registeredPhone, verificationCode.trim());
    } else {
      res = await verifyEmail(verificationCode.trim());
    }

    setVerifyLoading(false);

    if (res.success) {
      setStep('VERIFIED_SUCCESS');
    } else {
      setVerifyError(
        res.error ||
          res.nextAction ||
          'Mã xác thực không đúng hoặc đã hết hạn. Vui lòng kiểm tra lại.'
      );
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    const identifier = registeredEmail || registeredPhone;
    const channel = registeredEmail ? 'email' : 'phone';

    const res = await resendVerification(identifier, channel);
    if (res.success) {
      setResendCooldown(res.cooldownSeconds || 60);
      setResendMessage(
        `Đã gửi lại mã xác thực tới ${channel === 'email' ? 'email' : 'số điện thoại'}.`
      );
      setVerifyError(null);
    } else {
      setVerifyError(res.error || 'Gửi lại mã thất bại. Vui lòng thử lại.');
    }
  };

  const maskIdentifier = (val: string): string => {
    if (!val) return '';
    if (val.includes('@')) {
      const [name, domain] = val.split('@');
      return `${name.slice(0, 2)}***@${domain}`;
    }
    return `${val.slice(0, 4)}****${val.slice(-3)}`;
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans selection:bg-orange-600 selection:text-white relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(#CBD5E1_1px,transparent_1px)] [background-size:24px_24px] opacity-40 pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-lg relative z-10">
        {/* Brand Header */}
        <div className="text-center space-y-2 mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#ea4b12] to-[#c23807] text-white flex items-center justify-center font-black text-2xl mx-auto shadow-md shadow-orange-500/20">
            S
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
            {step === 'FORM' && 'Đăng Ký Cửa Hàng Mới'}
            {step === 'PENDING_VERIFICATION' && 'Xác Thực Tài Khoản'}
            {step === 'VERIFIED_SUCCESS' && 'Kích Hoạt Thành Công!'}
          </h2>
          <p className="text-sm text-slate-500">
            {step === 'FORM' &&
              'Nền tảng điều hành và kiểm soát vận chuyển dành riêng cho Shop Online'}
            {step === 'PENDING_VERIFICATION' &&
              'Vui lòng hoàn tất xác thực để bảo vệ an toàn cho cửa hàng của bạn'}
            {step === 'VERIFIED_SUCCESS' && 'Cửa hàng của bạn đã sẵn sàng hoạt động trên Ship Dễ'}
          </p>
        </div>

        {/* STEP 1: Registration Form */}
        {step === 'FORM' && (
          <div className="bg-white py-8 px-6 sm:px-10 shadow-xl shadow-slate-200/50 rounded-3xl border border-slate-200/80 space-y-5">
            {/* Duplicate Identifier Banner */}
            {duplicateIdentifier && (
              <div className="p-4 bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl text-xs space-y-2">
                <div className="flex items-center gap-2 font-bold text-amber-800">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{duplicateIdentifier}</span>
                </div>
                <p className="text-amber-700">
                  Bạn đã có tài khoản trên Ship Dễ? Vui lòng chuyển sang đăng nhập.
                </p>
                <button
                  type="button"
                  onClick={onSwitchToLogin}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-xs inline-flex items-center gap-1.5 shadow-sm"
                >
                  <span>Chuyển sang Đăng Nhập</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Rate Limited Alert */}
            {rateLimitMessage && (
              <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl text-xs space-y-1">
                <div className="flex items-center gap-2 font-bold text-rose-900">
                  <Clock className="w-4 h-4 shrink-0" />
                  <span>Giới hạn tần suất thao tác (Rate Limit)</span>
                </div>
                <p>{rateLimitMessage}</p>
              </div>
            )}

            {/* General Server Error */}
            {generalError && (
              <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-semibold flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-600 shrink-0" />
                <span>{generalError}</span>
              </div>
            )}

            <form onSubmit={handleRegister} className="space-y-4 text-xs">
              {/* Merchant Name */}
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1.5">
                  Tên Cửa Hàng / Thương Hiệu <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Store className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    type="text"
                    value={merchantName}
                    onChange={(e) => {
                      setMerchantName(e.target.value);
                      if (fieldErrors.merchant_name)
                        setFieldErrors({ ...fieldErrors, merchant_name: '' });
                    }}
                    placeholder="Ví dụ: Tiệm Bánh Nhà Mây, Thời Trang An An"
                    className={`modern-input w-full pl-10 h-11 text-xs font-medium ${
                      fieldErrors.merchant_name ? 'border-rose-400 bg-rose-50/20' : ''
                    }`}
                    disabled={loading}
                    required
                  />
                </div>
                {fieldErrors.merchant_name && (
                  <p className="mt-1 text-rose-600 font-semibold text-[11px]">
                    {fieldErrors.merchant_name}
                  </p>
                )}
              </div>

              {/* Full Name & Phone */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1.5">
                    Họ và Tên Chủ Shop <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => {
                        setFullName(e.target.value);
                        if (fieldErrors.full_name)
                          setFieldErrors({ ...fieldErrors, full_name: '' });
                      }}
                      placeholder="Nguyễn Văn A"
                      className={`modern-input w-full pl-10 h-11 text-xs font-medium ${
                        fieldErrors.full_name ? 'border-rose-400 bg-rose-50/20' : ''
                      }`}
                      disabled={loading}
                      required
                    />
                  </div>
                  {fieldErrors.full_name && (
                    <p className="mt-1 text-rose-600 font-semibold text-[11px]">
                      {fieldErrors.full_name}
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1.5">
                    Số Điện Thoại
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value);
                        if (fieldErrors.phone) setFieldErrors({ ...fieldErrors, phone: '' });
                      }}
                      placeholder="0901234567"
                      className={`modern-input w-full pl-10 h-11 text-xs font-medium ${
                        fieldErrors.phone ? 'border-rose-400 bg-rose-50/20' : ''
                      }`}
                      disabled={loading}
                    />
                  </div>
                  {fieldErrors.phone && (
                    <p className="mt-1 text-rose-600 font-semibold text-[11px]">
                      {fieldErrors.phone}
                    </p>
                  )}
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1.5">
                  Email Đăng Nhập & Nhận Thông Báo
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (fieldErrors.email) setFieldErrors({ ...fieldErrors, email: '' });
                    }}
                    placeholder="chushop@gmail.com"
                    className={`modern-input w-full pl-10 h-11 text-xs font-medium ${
                      fieldErrors.email ? 'border-rose-400 bg-rose-50/20' : ''
                    }`}
                    disabled={loading}
                  />
                </div>
                {fieldErrors.email && (
                  <p className="mt-1 text-rose-600 font-semibold text-[11px]">
                    {fieldErrors.email}
                  </p>
                )}
              </div>

              {/* Password */}
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1.5">
                  Mật Khẩu Thiết Lập <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (fieldErrors.password) setFieldErrors({ ...fieldErrors, password: '' });
                    }}
                    placeholder="Tối thiểu 8 ký tự"
                    className={`modern-input w-full pl-10 h-11 text-xs font-medium ${
                      fieldErrors.password ? 'border-rose-400 bg-rose-50/20' : ''
                    }`}
                    disabled={loading}
                    required
                  />
                </div>
                {fieldErrors.password && (
                  <p className="mt-1 text-rose-600 font-semibold text-[11px]">
                    {fieldErrors.password}
                  </p>
                )}
              </div>

              {/* Terms Acceptance (BR-AUTH-04) */}
              <div className="pt-1">
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(e) => {
                      setTermsAccepted(e.target.checked);
                      if (fieldErrors.terms_accepted) {
                        setFieldErrors({ ...fieldErrors, terms_accepted: '' });
                      }
                    }}
                    disabled={loading}
                    className="w-4 h-4 mt-0.5 rounded border-slate-300 text-[#ea4b12] focus:ring-[#ea4b12]"
                  />
                  <span className="text-[11px] leading-relaxed text-slate-600 font-normal">
                    Tôi đã đọc và đồng ý với{' '}
                    <span className="text-[#ea4b12] font-semibold hover:underline">
                      Điều khoản dịch vụ
                    </span>{' '}
                    và{' '}
                    <span className="text-[#ea4b12] font-semibold hover:underline">
                      Chính sách bảo mật
                    </span>{' '}
                    của Ship Dễ (Phiên bản 2026.1).
                  </span>
                </label>
                {fieldErrors.terms_accepted && (
                  <p className="mt-1 text-rose-600 font-semibold text-[11px]">
                    {fieldErrors.terms_accepted}
                  </p>
                )}
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full h-12 bg-[#ea4b12] hover:bg-[#d03e0b] disabled:bg-slate-300 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-md shadow-orange-500/25 transition-all mt-2 cursor-pointer disabled:cursor-not-allowed"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Đang khởi tạo tài khoản cửa hàng...</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <span>Đăng Ký & Kích Hoạt Cửa Hàng</span>
                    <ArrowRight className="w-4 h-4" />
                  </span>
                )}
              </button>
            </form>

            <div className="pt-3 text-center border-t border-slate-100">
              <button
                type="button"
                onClick={onSwitchToLogin}
                className="text-xs text-[#ea4b12] hover:text-[#c23807] font-bold hover:underline"
              >
                ← Đã có tài khoản? Quay lại đăng nhập
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: Pending Verification Screen */}
        {step === 'PENDING_VERIFICATION' && (
          <div className="bg-white py-8 px-6 sm:px-10 shadow-xl shadow-slate-200/50 rounded-3xl border border-slate-200/80 space-y-6">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mx-auto">
                <Mail className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Kiểm tra hòm thư / tin nhắn</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Mã xác thực tài khoản đã được gửi tới:{' '}
                <span className="font-bold text-slate-800">
                  {registeredEmail
                    ? maskIdentifier(registeredEmail)
                    : maskIdentifier(registeredPhone)}
                </span>
              </p>
            </div>

            {resendMessage && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                <span>{resendMessage}</span>
              </div>
            )}

            {verifyError && (
              <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{verifyError}</span>
              </div>
            )}

            <form onSubmit={handleVerify} className="space-y-4 text-xs">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1.5">
                  Nhập mã xác thực hoặc mã OTP
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    type="text"
                    value={verificationCode}
                    onChange={(e) => {
                      setVerificationCode(e.target.value);
                      if (verifyError) setVerifyError(null);
                    }}
                    placeholder={
                      registeredPhone ? 'Ví dụ: 123456' : 'Dán mã token từ liên kết email'
                    }
                    className="modern-input w-full pl-10 h-11 text-xs font-mono font-medium"
                    disabled={verifyLoading}
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={verifyLoading}
                className="w-full h-11 bg-[#ea4b12] hover:bg-[#d03e0b] disabled:bg-slate-300 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md shadow-orange-500/20"
              >
                {verifyLoading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Đang kiểm tra...</span>
                  </span>
                ) : (
                  <span>Xác Thực Ngay</span>
                )}
              </button>
            </form>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
              <button
                type="button"
                onClick={() => setStep('FORM')}
                className="text-slate-500 hover:text-slate-700 font-medium"
              >
                ← Sửa thông tin đăng ký
              </button>

              <button
                type="button"
                onClick={handleResend}
                disabled={resendCooldown > 0}
                className="text-[#ea4b12] hover:text-[#c23807] disabled:text-slate-400 font-bold inline-flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
              >
                <RefreshCw className="w-3 h-3" />
                <span>
                  {resendCooldown > 0 ? `Gửi lại sau (${resendCooldown}s)` : 'Gửi lại mã'}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Verification Success Screen */}
        {step === 'VERIFIED_SUCCESS' && (
          <div className="bg-white py-10 px-6 sm:px-10 shadow-xl shadow-slate-200/50 rounded-3xl border border-slate-200/80 text-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-inner">
              <CheckCircle2 className="w-10 h-10" />
            </div>

            <div className="space-y-2">
              <h3 className="text-xl font-extrabold text-slate-900">Xác Thực Thành Công!</h3>
              <p className="text-xs text-slate-600 max-w-sm mx-auto leading-relaxed">
                Tài khoản cửa hàng của bạn đã được kích hoạt thành công. Bạn có thể đăng nhập ngay
                để kết nối hãng vận chuyển và bắt đầu đối soát COD.
              </p>
            </div>

            <button
              type="button"
              onClick={onSwitchToLogin}
              className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-md shadow-emerald-600/25"
            >
              <span>Tiến Hành Đăng Nhập</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Security / Tenant Isolation Note */}
        <div className="text-center mt-6 text-xs text-slate-500 space-y-1">
          <div className="flex items-center justify-center gap-1.5 text-emerald-700 font-semibold">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Mỗi cửa hàng là một cơ sở dữ liệu phân vùng độc lập (Tenant Isolation)</span>
          </div>
        </div>
      </div>
    </div>
  );
};
