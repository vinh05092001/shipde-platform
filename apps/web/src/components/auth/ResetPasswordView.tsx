'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock, AlertCircle, CheckCircle2, Loader2, Eye, EyeOff, ChevronLeft } from 'lucide-react';

interface Props {
  onBackToLogin: () => void;
}
type ResetPasswordState =
  | 'VERIFYING'
  | 'VALID_TOKEN'
  | 'LOADING'
  | 'INVALID_TOKEN'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_USED'
  | 'SUCCESS'
  | 'FORBIDDEN'
  | 'ERROR';

export const ResetPasswordView: React.FC<Props> = ({ onBackToLogin }) => {
  const { verifyResetToken, resetPassword } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenFromUrl = searchParams.get('token') || '';

  const [state, setState] = useState<ResetPasswordState>('VERIFYING');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Array<{ field: string; message: string }>>([]);
  const [identifier, setIdentifier] = useState<string | null>(null);
  const [channel, setChannel] = useState<string | null>(null);
  const [passwordStrength, setPasswordStrength] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Verify token on mount
  useEffect(() => {
    if (!tokenFromUrl) {
      // A link with no token can be answered without asking the server, so this
      // one state is set straight away. Same exemption and reason as
      // ShipmentListTab, ThreeLedgersTab and AuthContext.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no token to verify
      setState('INVALID_TOKEN');
      return;
    }
    const verify = async () => {
      setState('VERIFYING');
      setErrorMessage(null);
      setFieldErrors([]);
      try {
        const res = await verifyResetToken(tokenFromUrl);
        if (!res.success) {
          if (res.code === 'TOKEN_EXPIRED') {
            setState('TOKEN_EXPIRED');
          } else if (res.code === 'TOKEN_ALREADY_USED') {
            setState('TOKEN_USED');
          } else {
            setState('INVALID_TOKEN');
          }
          setErrorMessage(res.error || 'Liên kết không hợp lệ.');
          return;
        }
        setState('VALID_TOKEN');
        setIdentifier(res.data?.identifier || null);
        setChannel(res.data?.channel || null);
      } catch {
        setState('ERROR');
        setErrorMessage('Lỗi kết nối máy chủ. Vui lòng thử lại.');
      }
    };
    verify();
  }, [tokenFromUrl]);

  const handlePasswordChange = (val: string) => {
    setPassword(val);
    let strength = 0;
    if (val.length >= 6) strength++;
    if (val.length >= 10) strength++;
    if (/[A-Z]/.test(val)) strength++;
    if (/[0-9]/.test(val)) strength++;
    if (/[^A-Za-z0-9]/.test(val)) strength++;
    setPasswordStrength(strength);
    setFieldErrors((prev) => prev.filter((f) => f.field !== 'newPassword'));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setFieldErrors([]);

    if (password !== passwordConfirm) {
      setFieldErrors([{ field: 'newPassword', message: 'Mật khẩu không khớp.' }]);
      return;
    }

    setState('LOADING');
    try {
      const res = await resetPassword({
        token: tokenFromUrl,
        password,
        password_confirm: passwordConfirm,
      });
      if (!res.success) {
        if (res.code === 'TOKEN_EXPIRED') {
          setState('TOKEN_EXPIRED');
          setErrorMessage(res.error || null);
        } else if (res.code === 'TOKEN_ALREADY_USED') {
          setState('TOKEN_USED');
          setErrorMessage(res.error || null);
        } else if (res.code === 'INVALID_TOKEN') {
          setState('INVALID_TOKEN');
          setErrorMessage(res.error || null);
          setFieldErrors(res.fields || []);
        } else if (res.code === 'VALIDATION_ERROR') {
          const mismatchField = res.fields?.find((f) => f.code === 'MISMATCH');
          if (mismatchField) {
            setState('VALID_TOKEN');
            setFieldErrors(res.fields || []);
          } else {
            setState('VALID_TOKEN');
            setFieldErrors(res.fields || []);
            setErrorMessage(res.error || 'Dữ liệu không hợp lệ');
          }
        } else {
          setState('ERROR');
          setErrorMessage(res.error || 'Có lỗi xảy ra.');
        }
        return;
      }
      setState('SUCCESS');
      timerRef.current = setTimeout(() => {
        onBackToLogin();
      }, 5000);
    } catch {
      setState('ERROR');
      setErrorMessage('Lỗi kết nối máy chủ. Vui lòng thử lại.');
    }
  };

  const handleBackToLogin = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    router.push('/');
  };

  const strengthLabels = ['Rất yếu', 'Yếu', 'Trung bình', 'Mạnh', 'Rất mạnh'];

  return (
    <div className="min-h-screen bg-[#FDFCFB] text-slate-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans selection:bg-[#EA4B12] selection:text-white relative">
      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="text-center space-y-2 mb-8">
          <button
            type="button"
            onClick={handleBackToLogin}
            aria-label="Quay lai dang nhap"
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <ChevronLeft className="w-6 h-6 mx-auto" />
          </button>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
            Đặt Lại Mật Khẩu
          </h1>
          <p className="text-sm text-slate-500">Nhập mật khẩu mới an toàn</p>
        </div>
        <div className="modern-card p-8 space-y-6 shadow-xl">
          {state === 'VERIFYING' && (
            <div className="flex flex-col items-center justify-center py-8 space-y-4 animate-in fade-in">
              <Loader2 className="w-10 h-10 border-4 border-[#EA4B12] border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-slate-600 font-medium">Đang xác minh liên kết...</span>
            </div>
          )}
          {state === 'ERROR' && (
            <div className="space-y-4 animate-in fade-in">
              <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-semibold flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Lỗi</p>
                  <p className="text-rose-700 mt-1">{errorMessage}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleBackToLogin}
                className="btn-secondary w-full justify-center text-sm py-3"
              >
                Quay lại đăng nhập
              </button>
            </div>
          )}
          {state === 'INVALID_TOKEN' && (
            <div className="space-y-4 animate-in fade-in">
              <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-semibold flex items-start gap-2">
                <Lock className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Liên kết không hợp lệ</p>
                  <p className="text-rose-700 mt-1">
                    {errorMessage || 'Liên kết đã được sử dụng hoặc không đúng định dạng.'}
                  </p>
                </div>
              </div>
              {fieldErrors.length > 0 && (
                <div className="text-xs text-rose-600 space-y-1">
                  {fieldErrors.map((fe, i) => (
                    <p key={i}>{fe.message}</p>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={handleBackToLogin}
                className="btn-secondary w-full justify-center text-sm py-3"
              >
                Quay lại đăng nhập
              </button>
            </div>
          )}

          {state === 'TOKEN_EXPIRED' && (
            <div className="space-y-4 animate-in fade-in">
              <div className="p-3.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs font-semibold flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Liên kết đã hết hạn</p>
                  <p className="text-amber-700 mt-1">
                    {errorMessage || 'Vui lòng yêu cầu liên kết mới.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleBackToLogin}
                className="btn-primary w-full justify-center text-sm py-3"
              >
                Quay lại đăng nhập
              </button>
            </div>
          )}
          {state === 'TOKEN_USED' && (
            <div className="space-y-4 animate-in fade-in">
              <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-semibold flex items-start gap-2">
                <Lock className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Liên kết đã được sử dụng</p>
                  <p className="text-rose-700 mt-1">
                    {errorMessage || 'Mật khẩu đã được thay đổi. Vui lòng đăng nhập.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleBackToLogin}
                className="btn-primary w-full justify-center text-sm py-3"
              >
                Đăng nhập
              </button>
            </div>
          )}
          {state === 'FORBIDDEN' && (
            <div className="space-y-4 animate-in fade-in">
              <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-semibold flex items-start gap-2">
                <Lock className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Tài khoản bị khóa</p>
                  <p className="text-rose-700 mt-1">
                    {errorMessage || 'Tài khoản này không thể đặt lại mật khẩu.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleBackToLogin}
                className="btn-secondary w-full justify-center text-sm py-3"
              >
                Quay lại đăng nhập
              </button>
            </div>
          )}

          {state === 'VALID_TOKEN' && (
            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1.5">
                  Mật khẩu mới
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => handlePasswordChange(e.target.value)}
                    placeholder="Nhập mật khẩu mới"
                    className="modern-input pr-10 h-11 text-sm font-medium"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label="Hien thi mat khau"
                    className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {passwordStrength > 0 && (
                <div className="space-y-1.5">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((bar) => (
                      <div
                        key={bar}
                        className={`h-1.5 flex-1 rounded-full ${bar <= passwordStrength ? (passwordStrength <= 2 ? 'bg-red-500' : passwordStrength <= 3 ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-slate-200'}`}
                      />
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-500 font-medium">
                    Độ mạnh: {strengthLabels[passwordStrength - 1]}
                  </p>
                </div>
              )}
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1.5">
                  Xác nhận mật khẩu
                </label>
                <div className="relative">
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    value={passwordConfirm}
                    onChange={(e) => {
                      setPasswordConfirm(e.target.value);
                      setFieldErrors((prev) => prev.filter((f) => f.field !== 'newPassword'));
                    }}
                    placeholder="Nhập lại mật khẩu"
                    className="modern-input pr-10 h-11 text-sm font-medium"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    aria-label="Hien thi xac nhan mat khau"
                    className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
                  >
                    {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {fieldErrors.map((fe, i) => (
                <div
                  key={i}
                  className="text-xs text-rose-600 font-semibold bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 animate-in fade-in"
                >
                  {fe.message}
                </div>
              ))}
              <button
                type="submit"
                disabled={!password || password.length < 8 || password !== passwordConfirm}
                className="btn-primary w-full justify-center text-sm py-3 font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Đặt lại mật khẩu
              </button>
            </form>
          )}

          {state === 'LOADING' && (
            <div className="flex flex-col items-center justify-center py-8 space-y-4 animate-in fade-in">
              <Loader2 className="w-10 h-10 border-4 border-[#EA4B12] border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-slate-600 font-medium">Đang đặt lại mật khẩu...</span>
            </div>
          )}
          {state === 'SUCCESS' && (
            <div className="flex flex-col items-center justify-center py-4 space-y-4 animate-in fade-in">
              <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-600" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-bold text-slate-900">Đặt lại mật khẩu thành công</p>
                <p className="text-xs text-slate-500">
                  Hướng dẫn tự động đăng nhập trong 5 giây...
                </p>
              </div>
              <button
                type="button"
                onClick={handleBackToLogin}
                className="btn-primary w-full justify-center text-sm py-3"
              >
                Quay lại đăng nhập
              </button>
            </div>
          )}
        </div>
        <div className="text-center mt-6 text-xs text-slate-500">
          Nhớ mật khẩu?{' '}
          <button
            type="button"
            onClick={handleBackToLogin}
            className="text-[#EA4B12] font-bold hover:underline"
          >
            Quay lại đăng nhập
          </button>
        </div>
      </div>
    </div>
  );
};
