'use client';

import React, { useEffect, useState } from 'react';
import { useAuth, AuthStatusBlock } from '@/context/AuthContext';
import {
  Mail,
  Lock,
  ArrowRight,
  ArrowLeft,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Smartphone,
} from 'lucide-react';

type LoginMode = 'CREDENTIALS' | 'OTP_IDENTIFIER' | 'OTP_CODE';

const RESEND_COOLDOWN_SECONDS = 60;

const STATUS_TITLE: Record<string, string> = {
  AUTH_PENDING_VERIFICATION: 'Tài khoản chưa xác thực',
  AUTH_ACCOUNT_SUSPENDED: 'Tài khoản đã bị tạm ngưng',
  AUTH_ACCOUNT_DISABLED: 'Tài khoản đã bị vô hiệu hóa',
  AUTH_INVITATION_PENDING: 'Lời mời tham gia cửa hàng chưa được chấp nhận',
};

const formatRetry = (seconds: number): string => {
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} phút`;
  return `${seconds} giây`;
};

interface Props {
  onSwitchToRegister: () => void;
}

export const LoginView: React.FC<Props> = ({ onSwitchToRegister }) => {
  const { login, requestLoginOtp, verifyLoginOtp, resendVerification } = useAuth();

  const [mode, setMode] = useState<LoginMode>('CREDENTIALS');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{
    account?: string;
    password?: string;
    otp?: string;
  } | null>(null);
  const [statusBlock, setStatusBlock] = useState<AuthStatusBlock | null>(null);
  const [otpChallenge, setOtpChallenge] = useState<{
    maskedIdentifier?: string;
    channel?: string;
    expiresIn?: number;
  } | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendBusy, setResendBusy] = useState(false);

  useEffect(() => {
    if (resendCooldown <= 0) return undefined;
    const timer = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const resetMessages = () => {
    setErrorMsg(null);
    setInfoMsg(null);
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();

    const nextField: { account?: string; password?: string } = {};
    if (!account.trim()) nextField.account = 'Vui lòng nhập email hoặc số điện thoại.';
    if (!password) nextField.password = 'Vui lòng nhập mật khẩu.';
    setFieldError(Object.keys(nextField).length ? nextField : null);
    if (Object.keys(nextField).length) return;

    setLoading(true);
    const res = await login(account.trim(), password, rememberMe);
    setLoading(false);

    if (res.success) return; // Session applied by AuthContext; the app shell re-renders.

    if (res.statusBlock) {
      setStatusBlock(res.statusBlock);
      return;
    }
    if (res.code === 'RATE_LIMITED') {
      const retry = res.retryAfterSeconds
        ? ` (thử lại sau ${formatRetry(res.retryAfterSeconds)})`
        : '';
      setErrorMsg(`${res.error || 'Bạn đã thử đăng nhập quá nhiều lần.'}${retry}`);
      return;
    }
    setErrorMsg(res.error || 'Đăng nhập không thành công. Vui lòng kiểm tra lại tài khoản.');
  };

  const handleStartOtp = () => {
    resetMessages();
    setStatusBlock(null);
    setFieldError(null);
    setOtpCode('');
    setMode('OTP_IDENTIFIER');
  };

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();

    if (!account.trim()) {
      setFieldError({ account: 'Vui lòng nhập email hoặc số điện thoại.' });
      return;
    }
    setFieldError(null);
    setLoading(true);
    const res = await requestLoginOtp(account.trim());
    setLoading(false);

    if (res.success) {
      setOtpChallenge({
        maskedIdentifier: res.maskedIdentifier,
        channel: res.channel,
        expiresIn: res.expiresIn,
      });
      setOtpCode('');
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setInfoMsg(
        `Mã OTP đã được gửi đến ${res.maskedIdentifier || 'kênh đã xác thực của bạn'}. Mã có hiệu lực ${formatRetry(res.expiresIn || 300)}.`
      );
      setMode('OTP_CODE');
      return;
    }
    if (res.code === 'AUTH_OTP_LOGIN_DISABLED') {
      setErrorMsg(res.error || 'Đăng nhập bằng mã OTP hiện không được kích hoạt.');
      return;
    }
    if (res.code === 'RATE_LIMITED') {
      const retry = res.retryAfterSeconds
        ? ` (thử lại sau ${formatRetry(res.retryAfterSeconds)})`
        : '';
      setErrorMsg(`${res.error || 'Bạn đã yêu cầu mã OTP quá nhiều lần.'}${retry}`);
      return;
    }
    setErrorMsg(res.error || 'Không gửi được mã OTP. Vui lòng thử lại.');
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();

    if (!/^\d{6}$/.test(otpCode.trim())) {
      setFieldError({ otp: 'Mã OTP gồm 6 chữ số.' });
      return;
    }
    setFieldError(null);
    setLoading(true);
    const res = await verifyLoginOtp(account.trim(), otpCode.trim());
    setLoading(false);

    if (res.success) return; // Session applied by AuthContext; the app shell re-renders.

    if (res.statusBlock) {
      setStatusBlock(res.statusBlock);
      return;
    }
    if (
      res.code === 'OTP_ALREADY_CONSUMED' ||
      res.code === 'OTP_EXPIRED' ||
      res.code === 'OTP_MAX_ATTEMPTS_EXCEEDED'
    ) {
      setErrorMsg(res.error || 'Mã OTP không còn hiệu lực. Vui lòng yêu cầu mã mới.');
      return;
    }
    setFieldError({ otp: res.error || 'Mã OTP không đúng. Vui lòng thử lại.' });
  };

  const handleResendOtp = async () => {
    resetMessages();
    setResendBusy(true);
    const res = await requestLoginOtp(account.trim());
    setResendBusy(false);

    if (res.success) {
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setInfoMsg(
        `Mã OTP mới đã được gửi đến ${res.maskedIdentifier || otpChallenge?.maskedIdentifier || 'kênh đã xác thực của bạn'}.`
      );
      return;
    }
    if (res.code === 'RATE_LIMITED') {
      setResendCooldown(res.retryAfterSeconds || RESEND_COOLDOWN_SECONDS);
      setErrorMsg(res.error || 'Vui lòng đợi trước khi yêu cầu mã mới.');
      return;
    }
    setErrorMsg(res.error || 'Không gửi được mã OTP mới.');
  };

  const handleResendVerification = async () => {
    resetMessages();
    setResendBusy(true);
    const res = await resendVerification(account.trim(), 'email');
    setResendBusy(false);

    if (res.success) {
      setInfoMsg(`Đã gửi lại liên kết xác thực đến ${account.trim()}.`);
      return;
    }
    setErrorMsg(res.error || 'Không gửi lại được email xác thực.');
  };

  const handleBackToCredentials = () => {
    resetMessages();
    setStatusBlock(null);
    setFieldError(null);
    setMode('CREDENTIALS');
  };

  return (
    <div className="min-h-screen bg-[#FDFCFB] text-slate-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans selection:bg-[#EA4B12] selection:text-white relative">
      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        {/* Brand Logo & Title */}
        <div className="text-center space-y-2 mb-8">
          <div className="w-14 h-14 rounded-2xl bg-[#EA4B12] text-white flex items-center justify-center font-black text-2xl mx-auto shadow-md shadow-[#EA4B12]/20">
            S
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
            Đăng Nhập Ship Dễ
          </h1>
          <p className="text-sm text-slate-500">
            Hệ thống kiểm soát vận hành &amp; đối soát COD tự động cho Online Shop
          </p>
        </div>

        {/* Main Login Card */}
        <div className="modern-card p-8 space-y-6 shadow-xl">
          {statusBlock ? (
            <div className="space-y-4 text-center" data-testid="login-status-block">
              <div
                className={`w-12 h-12 rounded-2xl mx-auto flex items-center justify-center ${
                  statusBlock.code === 'AUTH_ACCOUNT_SUSPENDED' ||
                  statusBlock.code === 'AUTH_ACCOUNT_DISABLED'
                    ? 'bg-rose-50 text-rose-600'
                    : 'bg-amber-50 text-amber-600'
                }`}
              >
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-base font-bold text-slate-900">
                  {STATUS_TITLE[statusBlock.code] || 'Không thể đăng nhập'}
                </h2>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {statusBlock.message || 'Tài khoản của bạn hiện không thể đăng nhập.'}
                </p>
                {statusBlock.nextAction && (
                  <p className="text-xs text-slate-500 leading-relaxed">{statusBlock.nextAction}</p>
                )}
              </div>
              {statusBlock.code === 'AUTH_PENDING_VERIFICATION' && (
                <button
                  type="button"
                  onClick={handleResendVerification}
                  disabled={resendBusy}
                  className="btn-primary w-full justify-center text-sm py-3 font-bold"
                >
                  {resendBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    'Gửi lại email xác thực'
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={handleBackToCredentials}
                className="text-xs text-slate-500 font-semibold hover:text-slate-700 hover:underline"
              >
                ← Quay lại đăng nhập
              </button>
            </div>
          ) : (
            <>
              {errorMsg && (
                <div
                  className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-semibold flex items-start gap-2"
                  data-testid="login-error"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {infoMsg && (
                <div
                  className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-semibold flex items-start gap-2"
                  data-testid="login-info"
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{infoMsg}</span>
                </div>
              )}

              {mode === 'CREDENTIALS' && (
                <>
                  <form onSubmit={handlePasswordLogin} className="space-y-4 text-xs">
                    <div>
                      <label className="text-xs font-bold text-slate-700 block mb-1.5">
                        Email hoặc Số Điện Thoại
                      </label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                        <input
                          type="text"
                          value={account}
                          onChange={(e) => setAccount(e.target.value)}
                          placeholder="email@cuahang.vn hoặc 09xx.xxx.xxx"
                          autoComplete="username"
                          className="modern-input pl-10 h-11 text-sm font-medium"
                        />
                      </div>
                      {fieldError?.account && (
                        <p className="text-[11px] text-rose-600 font-semibold mt-1.5">
                          {fieldError.account}
                        </p>
                      )}
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-1.5">
                        <label className="text-xs font-bold text-slate-700">Mật Khẩu</label>
                        <span
                          title="Tính năng khôi phục mật khẩu sẽ ra mắt sau. Vui lòng liên hệ CSKH nếu bạn cần hỗ trợ."
                          className="text-xs text-slate-400 font-semibold cursor-not-allowed"
                        >
                          Quên mật khẩu?
                        </span>
                      </div>
                      <div className="relative">
                        <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="••••••••"
                          autoComplete="current-password"
                          className="modern-input pl-10 pr-10 h-11 text-sm font-medium"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-3.5 text-slate-400 hover:text-slate-600"
                        >
                          {showPassword ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                      {fieldError?.password && (
                        <p className="text-[11px] text-rose-600 font-semibold mt-1.5">
                          {fieldError.password}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={rememberMe}
                          onChange={(e) => setRememberMe(e.target.checked)}
                          className="w-4 h-4 rounded text-[#EA4B12] focus:ring-[#EA4B12] border-slate-300"
                        />
                        <span>Ghi nhớ đăng nhập trên thiết bị này</span>
                      </label>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="btn-primary w-full justify-center text-sm py-3 font-bold mt-2"
                    >
                      {loading ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Đang Xác Thực...
                        </span>
                      ) : (
                        <>
                          <span>Vào Bàn Điều Khiển</span>
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </form>

                  {/* OTP alternative (SCR-AUTH-01: rendered always, usable only when the operator enables it) */}
                  <div className="pt-5 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={handleStartOtp}
                      className="w-full p-3 rounded-xl border border-slate-200 hover:border-[#EA4B12] hover:bg-[#FFF5F0] transition flex items-center justify-center gap-2 text-xs font-bold text-slate-700"
                    >
                      <Smartphone className="w-4 h-4 text-[#EA4B12]" />
                      Đăng nhập bằng mã OTP
                    </button>
                    <p className="text-[11px] text-slate-400 text-center mt-2">
                      Chỉ khả dụng khi cửa hàng của bạn bật đăng nhập bằng mã OTP.
                    </p>
                  </div>
                </>
              )}

              {mode === 'OTP_IDENTIFIER' && (
                <form onSubmit={handleRequestOtp} className="space-y-4 text-xs">
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Nhập email hoặc số điện thoại đã xác thực của bạn. Chúng tôi sẽ gửi một mã OTP
                    gồm 6 chữ số để đăng nhập mà không cần mật khẩu.
                  </p>
                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1.5">
                      Email hoặc Số Điện Thoại
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                      <input
                        type="text"
                        value={account}
                        onChange={(e) => setAccount(e.target.value)}
                        placeholder="email@cuahang.vn hoặc 09xx.xxx.xxx"
                        autoComplete="username"
                        className="modern-input pl-10 h-11 text-sm font-medium"
                      />
                    </div>
                    {fieldError?.account && (
                      <p className="text-[11px] text-rose-600 font-semibold mt-1.5">
                        {fieldError.account}
                      </p>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="btn-primary w-full justify-center text-sm py-3 font-bold"
                  >
                    {loading ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Đang Gửi Mã...
                      </span>
                    ) : (
                      'Gửi Mã OTP'
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleBackToCredentials}
                    className="w-full flex items-center justify-center gap-1.5 text-xs text-slate-500 font-semibold hover:text-slate-700 hover:underline"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Đăng nhập bằng mật khẩu
                  </button>
                </form>
              )}

              {mode === 'OTP_CODE' && (
                <form onSubmit={handleVerifyOtp} className="space-y-4 text-xs">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 leading-relaxed">
                    Nhập mã OTP gồm 6 chữ số đã được gửi đến{' '}
                    <span className="font-bold text-slate-800">
                      {otpChallenge?.maskedIdentifier || 'kênh đã xác thực của bạn'}
                    </span>
                    {otpChallenge?.expiresIn
                      ? ` (hiệu lực ${formatRetry(otpChallenge.expiresIn)})`
                      : ''}
                    . Mã chỉ dùng được một lần.
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1.5">Mã OTP</label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="••••••"
                        className="modern-input pl-10 h-11 text-sm font-medium tracking-[0.4em]"
                      />
                    </div>
                    {fieldError?.otp && (
                      <p className="text-[11px] text-rose-600 font-semibold mt-1.5">
                        {fieldError.otp}
                      </p>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="btn-primary w-full justify-center text-sm py-3 font-bold"
                  >
                    {loading ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Đang Xác Thực...
                      </span>
                    ) : (
                      <>
                        <span>Xác Nhận &amp; Đăng Nhập</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={handleResendOtp}
                      disabled={resendBusy || resendCooldown > 0}
                      className="text-xs text-[#EA4B12] font-semibold hover:underline disabled:text-slate-400 disabled:cursor-not-allowed disabled:no-underline"
                    >
                      {resendBusy
                        ? 'Đang gửi lại...'
                        : resendCooldown > 0
                          ? `Gửi lại mã sau ${resendCooldown}s`
                          : 'Gửi lại mã OTP'}
                    </button>
                    <button
                      type="button"
                      onClick={handleStartOtp}
                      className="text-xs text-slate-500 font-semibold hover:text-slate-700 hover:underline"
                    >
                      ← Dùng tài khoản khác
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="text-center mt-6 text-xs text-slate-500">
          Chưa có tài khoản?{' '}
          <button
            type="button"
            onClick={onSwitchToRegister}
            className="text-[#EA4B12] font-bold hover:underline"
          >
            Đăng ký tài khoản mới
          </button>
        </div>
      </div>
    </div>
  );
};
