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
  Sparkles,
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
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans selection:bg-blue-600 selection:text-white relative overflow-hidden">
      {/* Subtle Background Pattern */}
      <div className="absolute inset-0 bg-[radial-gradient(#CBD5E1_1px,transparent_1px)] [background-size:24px_24px] opacity-40 pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        {/* Brand Logo & Title */}
        <div className="text-center space-y-2 mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-700 text-white flex items-center justify-center font-black text-2xl mx-auto shadow-md shadow-blue-500/20">
            S
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
            Đăng Nhập Ship Dễ
          </h2>
          <p className="text-sm text-slate-500">
            Hệ thống điều hành vận chuyển & kiểm soát đối soát COD cho Online Shop
          </p>
        </div>

        {/* Main Login Card */}
        <div className="bg-white py-8 px-6 sm:px-10 shadow-xl shadow-slate-200/50 rounded-3xl border border-slate-200/80 space-y-6">
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
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  placeholder="owner@ananboutique.vn"
                  className="modern-input w-full pl-10 h-11 text-xs font-medium"
                  required
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-bold text-slate-700">
                  Mật Khẩu
                </label>
                <button
                  type="button"
                  onClick={() => alert('Mã OTP xác thực đã được gửi về số điện thoại đăng ký của bạn.')}
                  className="text-xs text-blue-600 hover:text-blue-700 font-semibold hover:underline"
                >
                  Quên mật khẩu?
                </button>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="modern-input w-full pl-10 pr-10 h-11 text-xs font-medium"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-3 text-slate-400 hover:text-slate-700"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer"
                />
                <span className="text-xs text-slate-600 font-medium">Ghi nhớ đăng nhập trên máy này</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full h-12 text-sm font-bold justify-center shadow-md shadow-blue-500/25 mt-2"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Đang xác thực...</span>
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <span>Đăng Nhập Vào Hệ Thống</span>
                  <ArrowRight className="w-4 h-4" />
                </span>
              )}
            </button>
          </form>

          {/* 1-Click Role Access Buttons for Instant Testing */}
          <div className="pt-4 border-t border-slate-100 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Đăng nhập nhanh theo vai trò test:
              </span>
              <span className="badge-info text-[10px]">1-Click Demo</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleQuickLogin('owner@ananboutique.vn')}
                className="p-2.5 rounded-xl border border-slate-200 hover:border-blue-400 bg-slate-50/70 hover:bg-blue-50/50 text-left transition flex items-center gap-2.5 cursor-pointer group"
              >
                <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <Store className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-slate-900 text-xs leading-tight">Chủ Shop</div>
                  <div className="text-[10px] text-slate-500">Owner (Toàn quyền)</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickLogin('cskh1@ananboutique.vn')}
                className="p-2.5 rounded-xl border border-slate-200 hover:border-emerald-400 bg-slate-50/70 hover:bg-emerald-50/50 text-left transition flex items-center gap-2.5 cursor-pointer group"
              >
                <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <Headphones className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-slate-900 text-xs leading-tight">CSKH / Vận Hành</div>
                  <div className="text-[10px] text-slate-500">Cứu đơn & Hộp việc</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickLogin('ketoan@ananboutique.vn')}
                className="p-2.5 rounded-xl border border-slate-200 hover:border-amber-400 bg-slate-50/70 hover:bg-amber-50/50 text-left transition flex items-center gap-2.5 cursor-pointer group"
              >
                <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <Calculator className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-slate-900 text-xs leading-tight">Kế Toán</div>
                  <div className="text-[10px] text-slate-500">Duyệt đối soát COD</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickLogin('kho@ananboutique.vn')}
                className="p-2.5 rounded-xl border border-slate-200 hover:border-purple-400 bg-slate-50/70 hover:bg-purple-50/50 text-left transition flex items-center gap-2.5 cursor-pointer group"
              >
                <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <Warehouse className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-slate-900 text-xs leading-tight">Thủ Kho</div>
                  <div className="text-[10px] text-slate-500">Quét hàng hoàn kho</div>
                </div>
              </button>
            </div>
          </div>

          <div className="pt-2 text-center border-t border-slate-100">
            <button
              type="button"
              onClick={onSwitchToRegister}
              className="text-xs text-blue-600 hover:text-blue-700 font-bold hover:underline"
            >
              Chưa có tài khoản? Đăng ký cửa hàng mới →
            </button>
          </div>
        </div>

        {/* Trust & Invariant Footer */}
        <div className="text-center mt-6 text-xs text-slate-500 space-y-1.5">
          <div className="flex items-center justify-center gap-1.5 text-emerald-700 font-semibold">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Quy tắc bất biến: Tuyệt đối không giữ tiền COD của Shop (BR-10)</span>
          </div>
          <p className="text-[11px] text-slate-400 font-mono">Bản quyền © 2026 Ship Dễ · Control-First Operational Console</p>
        </div>
      </div>
    </div>
  );
};
