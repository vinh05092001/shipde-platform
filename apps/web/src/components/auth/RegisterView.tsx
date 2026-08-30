'use client';

import React, { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  ShieldCheck,
  Building2,
  Store,
  Phone,
  Mail,
  Lock,
  ArrowRight,
  User,
  CheckCircle2,
} from 'lucide-react';

interface Props {
  onSwitchToLogin: () => void;
}

export const RegisterView: React.FC<Props> = ({ onSwitchToLogin }) => {
  const { register } = useAuth();
  const [merchantName, setMerchantName] = useState('An An Boutique');
  const [fullName, setFullName] = useState('Nguyễn Văn An');
  const [email, setEmail] = useState('owner@ananboutique.vn');
  const [phone, setPhone] = useState('0901234567');
  const [password, setPassword] = useState('12345678');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);

    const res = await register({
      merchantName,
      fullName,
      email,
      phone,
      password,
    });

    if (!res.success) {
      setErrorMsg(res.error || 'Đăng ký không thành công. Vui lòng kiểm tra lại thông tin.');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans selection:bg-blue-600 selection:text-white relative overflow-hidden">
      {/* Subtle Background Pattern */}
      <div className="absolute inset-0 bg-[radial-gradient(#CBD5E1_1px,transparent_1px)] [background-size:24px_24px] opacity-40 pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-lg relative z-10">
        {/* Brand Logo & Title */}
        <div className="text-center space-y-2 mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-700 text-white flex items-center justify-center font-black text-2xl mx-auto shadow-md shadow-blue-500/20">
            S
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
            Đăng Ký Cửa Hàng Mới
          </h2>
          <p className="text-sm text-slate-500">
            Kích hoạt hệ thống kiểm soát đối soát COD & vận hành đa kênh
          </p>
        </div>

        {/* Main Register Card */}
        <div className="bg-white py-8 px-6 sm:px-10 shadow-xl shadow-slate-200/50 rounded-3xl border border-slate-200/80 space-y-6">
          {errorMsg && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-semibold flex items-center gap-2 animate-in fade-in">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleRegister} className="space-y-4 text-xs">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1.5">
                Tên Cửa Hàng / Thương Hiệu Shop
              </label>
              <div className="relative">
                <Store className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  value={merchantName}
                  onChange={(e) => setMerchantName(e.target.value)}
                  placeholder="Ví dụ: An An Boutique"
                  className="modern-input w-full pl-10 h-11 text-xs font-medium"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1.5">
                  Họ và Tên Chủ Shop
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Nguyễn Văn An"
                    className="modern-input w-full pl-10 h-11 text-xs font-medium"
                    required
                  />
                </div>
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
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0901234567"
                    className="modern-input w-full pl-10 h-11 text-xs font-medium"
                    required
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1.5">
                Email Quản Trị
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@ananboutique.vn"
                  className="modern-input w-full pl-10 h-11 text-xs font-medium"
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1.5">
                Mật Khẩu Thiết Lập
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="modern-input w-full pl-10 h-11 text-xs font-medium"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full h-12 text-sm font-bold justify-center shadow-md shadow-blue-500/25 mt-2"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Đang khởi tạo cửa hàng...</span>
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <span>Kích Hoạt Tài Khoản Cửa Hàng</span>
                  <ArrowRight className="w-4 h-4" />
                </span>
              )}
            </button>
          </form>

          <div className="pt-3 text-center border-t border-slate-100">
            <button
              type="button"
              onClick={onSwitchToLogin}
              className="text-xs text-blue-600 hover:text-blue-700 font-bold hover:underline"
            >
              ← Đã có tài khoản? Quay lại đăng nhập
            </button>
          </div>
        </div>

        {/* Security Assurance */}
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
