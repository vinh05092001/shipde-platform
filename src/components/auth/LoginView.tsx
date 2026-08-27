'use client';

import React, { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  ShieldCheck,
  Lock,
  Mail,
  ArrowRight,
  Eye,
  EyeOff,
  CheckCircle2,
  TrendingUp,
  PackageCheck,
  DollarSign,
  Store,
  ChevronRight,
  User,
  Headphones,
  Calculator,
  Warehouse,
} from 'lucide-react';

interface Props {
  onSwitchToRegister: () => void;
}

export const LoginView: React.FC<Props> = ({ onSwitchToRegister }) => {
  const { login } = useAuth();
  const [account, setAccount] = useState('owner@ananboutique.vn');
  const [password, setPassword] = useState('12345678');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setErrorMsg('Vui lòng nhập mật khẩu tài khoản.');
      return;
    }
    setLoading(true);
    setErrorMsg(null);

    const res = await login(account, password);
    if (!res.success) {
      setErrorMsg(res.error || 'Đăng nhập không thành công. Vui lòng kiểm tra lại tài khoản.');
    }
    setLoading(false);
  };

  const handleQuickLogin = async (presetEmail: string) => {
    setAccount(presetEmail);
    setLoading(true);
    setErrorMsg(null);
    await login(presetEmail, '12345678');
    setLoading(false);
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
            Hệ thống kiểm soát vận hành & đối soát COD tự động cho Online Shop
          </p>
        </div>

        {/* Main Login Card */}
        <div className="modern-card p-8 space-y-6 shadow-xl">
          {errorMsg && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-semibold flex items-center gap-2 animate-in fade-in">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4 text-xs">
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
                  placeholder="owner@ananboutique.vn"
                  className="modern-input pl-10 h-11 text-sm font-medium"
                  required
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-bold text-slate-700">Mật Khẩu</label>
                <a
                  href="#forgot"
                  onClick={(e) => {
                    e.preventDefault();
                    alert('Vui lòng liên hệ quản trị viên để đặt lại mật khẩu.');
                  }}
                  className="text-xs text-[#EA4B12] font-semibold hover:underline"
                >
                  Quên mật khẩu?
                </a>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="modern-input pl-10 pr-10 h-11 text-sm font-medium"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3.5 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
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
                <span>Đang Xác Thực...</span>
              ) : (
                <>
                  <span>Vào Bàn Điều Khiển</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Quick Demo Role Switcher for Development Environment */}
          <div className="pt-5 border-t border-slate-100 space-y-3">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block text-center">
              Chọn Nhanh Vai Trò Để Trải Nghiệm:
            </span>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleQuickLogin('owner@ananboutique.vn')}
                className="p-2.5 rounded-xl border border-slate-200 hover:border-[#EA4B12] hover:bg-[#FFF5F0] transition text-left cursor-pointer"
              >
                <div className="font-bold text-xs text-slate-900">👑 Chủ Shop</div>
                <div className="text-[11px] text-slate-500 truncate">owner@ananboutique.vn</div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickLogin('cskh.hoa@ananboutique.vn')}
                className="p-2.5 rounded-xl border border-slate-200 hover:border-[#EA4B12] hover:bg-[#FFF5F0] transition text-left cursor-pointer"
              >
                <div className="font-bold text-xs text-slate-900">🎧 CSKH / Vận Hành</div>
                <div className="text-[11px] text-slate-500 truncate">cskh.hoa@...</div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickLogin('ketoan@ananboutique.vn')}
                className="p-2.5 rounded-xl border border-slate-200 hover:border-[#EA4B12] hover:bg-[#FFF5F0] transition text-left cursor-pointer"
              >
                <div className="font-bold text-xs text-slate-900">📊 Kế Toán Đối Soát</div>
                <div className="text-[11px] text-slate-500 truncate">ketoan@...</div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickLogin('kho.tanbinh@ananboutique.vn')}
                className="p-2.5 rounded-xl border border-slate-200 hover:border-[#EA4B12] hover:bg-[#FFF5F0] transition text-left cursor-pointer"
              >
                <div className="font-bold text-xs text-slate-900">📦 Thủ Kho Quét Hoàn</div>
                <div className="text-[11px] text-slate-500 truncate">kho.tanbinh@...</div>
              </button>
            </div>
          </div>
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
