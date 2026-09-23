'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import {
  ShieldCheck,
  Mail,
  Phone,
  Lock,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ChevronLeft,
} from 'lucide-react';

interface Props {
  onBackToLogin: () => void;
}

type ForgotPasswordState = 'IDLE' | 'LOADING' | 'SUCCESS' | 'RATE_LIMITED' | 'FORBIDDEN';

export const ForgotPasswordView: React.FC<Props> = ({ onBackToLogin }) => {
  const { forgotPassword } = useAuth();
  const router = useRouter();

  const [identifier, setIdentifier] = useState('');
  const [state, setState] = useState<ForgotPasswordState>('IDLE');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rateLimitRetryAfter, setRateLimitRetryAfter] = useState<number | null>(null);
  const [submittedIdentifier, setSubmittedIdentifier] = useState<string | null>(null);
  const [submittedChannel, setSubmittedChannel] = useState<'email' | 'phone' | null>(null);

  // Countdown timer for rate limit
  useEffect(() => {
    if (!rateLimitRetryAfter || rateLimitRetryAfter <= 0) return;
    const timer = setInterval(() => {
      setRateLimitRetryAfter((prev) => (prev && prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [rateLimitRetryAfter]);

  const isEmail = identifier.includes('@');
  const channel = isEmail ? 'email' : 'phone';
  const isValidFormat = isEmail
    ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim())
    : /^(0|\+84)[3|5|7|8|9][0-9]{8}$/.test(identifier.trim().replace(/\s+/g, ''));

  const isEmpty = !identifier.trim();
  const isDisabled = state === 'LOADING' || state === 'SUCCESS' || isEmpty || !isValidFormat;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDisabled) return;

    setState('LOADING');
    setErrorMessage(null);

    try {
      const res = await forgotPassword(identifier.trim());
      if (!res.success) {
        if (res.code === 'RATE_LIMITED') {
          setState('RATE_LIMITED');
          setRateLimitRetryAfter(res.cooldownSeconds || 60);
          setErrorMessage(res.error || 'Quá nhiều yêu cầu. Vui lòng thử lại sau.');
        } else if (res.code === 'FORBIDDEN') {
          setState('FORBIDDEN');
          setErrorMessage(res.error || 'Tài khoản bị khóa, không thể yêu cầu đặt lại mật khẩu.');
        } else {
          setState('IDLE');
          setErrorMessage(res.error || 'Có lỗi xảy ra. Vui lòng thử lại.');
        }
        return;
      }

      // Success - token sent
      setState('SUCCESS');
      setSubmittedIdentifier(identifier.trim());
      setSubmittedChannel((res.data?.channel || channel) as 'email' | 'phone' | null);
    } catch {
      setState('IDLE');
      setErrorMessage('Lỗi kết nối máy chủ. Vui lòng thử lại sau.');
    }
  };

  const handleTryAgain = () => {
    setState('IDLE');
    setErrorMessage(null);
    setRateLimitRetryAfter(null);
    setSubmittedIdentifier(null);
    setSubmittedChannel(null);
  };

  const handleBackToLogin = () => {
    onBackToLogin();
  };

  return (
    <div className="min-h-screen bg-[#FDFCFB] text-slate-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans selection:bg-[#EA4B12] selection:text-white relative">
      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="text-center space-y-2 mb-8">
          <div className="w-14 h-14 rounded-2xl bg-[#EA4B12] text-white flex items-center justify-center font-black text-2xl mx-auto shadow-md shadow-[#EA4B12]/20">
            S
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
            Khôi Phục Mật Khẩu
          </h1>
          <p className="text-sm text-slate-500">
            Nhập email hoặc số điện thoại để đặt lại mật khẩu
          </p>
        </div>
        <div className="modern-card p-8 space-y-6 shadow-xl">
          {state === 'LOADING' && (
            <div className="flex flex-col items-center justify-center py-8 space-y-4 animate-in fade-in">
              <Loader2 className="w-10 h-10 border-4 border-[#EA4B12] border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-slate-600 font-medium">Đang gửi liên kết...</span>
            </div>
          )}
          {state === 'IDLE' && isEmpty && (
            <div className="p-3.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs font-semibold flex items-center gap-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Vui lòng nhập email hoặc số điện thoại</span>
            </div>
          )}
          {state === 'IDLE' && errorMessage && !isEmpty && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-semibold flex items-center gap-2 animate-in fade-in">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
          {state === 'RATE_LIMITED' && (
            <div className="space-y-4 animate-in fade-in">
              <div className="p-3.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs font-semibold flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Quá nhiều yêu cầu</p>
                  <p className="text-amber-700 mt-1">Thử lại sau {rateLimitRetryAfter} giây</p>
                </div>
              </div>
              <button
                type="button"
                disabled
                className="btn-primary w-full justify-center text-sm py-3 opacity-50 cursor-not-allowed"
              >
                Đang chờ...
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
          {state === 'SUCCESS' && (
            <div className="space-y-4 animate-in fade-in">
              <div className="flex flex-col items-center py-4 space-y-3">
                <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sm font-bold text-slate-900">Liên kết đã được gửi</p>
                  <p className="text-xs text-slate-500">
                    Kiểm tra {submittedChannel === 'email' ? 'email' : 'SMS'}
                  </p>
                </div>
              </div>
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-medium">
                Nếu tài khoản tồn tại và đã xác thực, liên kết đặt lại mật khẩu đã được gửi.
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
          {state === 'IDLE' && (
            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1.5">
                  Email hoặc Số Điện Thoại
                </label>
                <div className="relative">
                  {isEmail ? (
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                  ) : (
                    <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                  )}
                  <input
                    type="text"
                    value={identifier}
                    onChange={(e) => {
                      setIdentifier(e.target.value);
                      if (errorMessage) setErrorMessage(null);
                    }}
                    placeholder="owner@ananboutique.vn hoặc 0901234567"
                    className="modern-input pl-10 h-11 text-sm font-medium"
                    autoFocus
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={isDisabled}
                className="btn-primary w-full justify-center text-sm py-3 font-bold"
              >
                Gửi liên kết đặt lại mật khẩu
              </button>
            </form>
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
