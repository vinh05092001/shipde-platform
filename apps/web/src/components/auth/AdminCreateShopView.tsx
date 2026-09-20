'use client';

import React, { useState } from 'react';
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
  KeyRound,
  Loader2,
} from 'lucide-react';

interface Props {
  onBack?: () => void;
}

type Step = 'FORM' | 'SUCCESS' | 'FORBIDDEN';

export const AdminCreateShopView: React.FC<Props> = ({ onBack }) => {
  const { adminCreateShopAccount } = useAuth();

  const [merchantName, setMerchantName] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [operatorToken, setOperatorToken] = useState('');

  const [step, setStep] = useState<Step>('FORM');
  const [loading, setLoading] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [createdData, setCreatedData] = useState<{ merchant_id: string; merchant_code: string; user_id: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);
    setFieldErrors({});

    if (!operatorToken.trim()) {
      setFieldErrors({ operator_token: 'Vui lòng nhập token operator.' });
      return;
    }

    setLoading(true);
    const res = await adminCreateShopAccount({
      merchant_name: merchantName.trim(),
      full_name: fullName.trim(),
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      password,
      operator_token: operatorToken.trim(),
    });
    setLoading(false);

    if (!res.success) {
      if (res.code === 'UNAUTHORIZED' || res.code === 'FORBIDDEN') {
        setStep('FORBIDDEN');
        setGeneralError(res.error || 'Không có quyền thực hiện thao tác này.');
        return;
      }
      if (res.fields && res.fields.length > 0) {
        const errs: Record<string, string> = {};
        for (const f of res.fields) {
          errs[f.field] = f.message;
        }
        setFieldErrors(errs);
      } else {
        setGeneralError(res.error || 'Tạo tài khoản thất bại.');
      }
      return;
    }

    setCreatedData(res.data);
    setStep('SUCCESS');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-extrabold text-slate-900">Tạo Cửa Hàng (Admin)</h1>
          <p className="text-sm text-slate-500">Dành cho operator nền tảng Ship Dễ</p>
        </div>

        {step === 'FORM' && (
          <div className="bg-white py-8 px-6 shadow-xl rounded-3xl border border-slate-200/80 space-y-5">
            {generalError && (
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                <span>{generalError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Token Operator</label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="password"
                    value={operatorToken}
                    onChange={(e) => setOperatorToken(e.target.value)}
                    className={`w-full h-11 pl-10 pr-4 rounded-xl border text-sm focus:outline-none focus:ring-2 ${fieldErrors.operator_token ? 'border-red-400 focus:ring-red-200' : 'border-slate-200 focus:ring-orange-200'}`}
                    placeholder="Nhập token xác thực operator"
                  />
                </div>
                {fieldErrors.operator_token && <p className="text-xs text-red-500 mt-1">{fieldErrors.operator_token}</p>}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Tên cửa hàng</label>
                <div className="relative">
                  <Store className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={merchantName}
                    onChange={(e) => setMerchantName(e.target.value)}
                    className={`w-full h-11 pl-10 pr-4 rounded-xl border text-sm focus:outline-none focus:ring-2 ${fieldErrors.merchant_name ? 'border-red-400 focus:ring-red-200' : 'border-slate-200 focus:ring-orange-200'}`}
                    placeholder="VD: Thời Trang ABC"
                  />
                </div>
                {fieldErrors.merchant_name && <p className="text-xs text-red-500 mt-1">{fieldErrors.merchant_name}</p>}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Họ tên chủ shop</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className={`w-full h-11 pl-10 pr-4 rounded-xl border text-sm focus:outline-none focus:ring-2 ${fieldErrors.full_name ? 'border-red-400 focus:ring-red-200' : 'border-slate-200 focus:ring-orange-200'}`}
                    placeholder="Nguyễn Văn A"
                  />
                </div>
                {fieldErrors.full_name && <p className="text-xs text-red-500 mt-1">{fieldErrors.full_name}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={`w-full h-11 pl-10 pr-4 rounded-xl border text-sm focus:outline-none focus:ring-2 ${fieldErrors.email ? 'border-red-400 focus:ring-red-200' : 'border-slate-200 focus:ring-orange-200'}`}
                      placeholder="owner@shop.vn"
                    />
                  </div>
                  {fieldErrors.email && <p className="text-xs text-red-500 mt-1">{fieldErrors.email}</p>}
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Điện thoại</label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className={`w-full h-11 pl-10 pr-4 rounded-xl border text-sm focus:outline-none focus:ring-2 ${fieldErrors.phone ? 'border-red-400 focus:ring-red-200' : 'border-slate-200 focus:ring-orange-200'}`}
                      placeholder="0901234567"
                    />
                  </div>
                  {fieldErrors.phone && <p className="text-xs text-red-500 mt-1">{fieldErrors.phone}</p>}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Mật khẩu tạm</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`w-full h-11 pl-10 pr-4 rounded-xl border text-sm focus:outline-none focus:ring-2 ${fieldErrors.password ? 'border-red-400 focus:ring-red-200' : 'border-slate-200 focus:ring-orange-200'}`}
                    placeholder="Tối thiểu 8 ký tự"
                  />
                </div>
                {fieldErrors.password && <p className="text-xs text-red-500 mt-1">{fieldErrors.password}</p>}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 bg-[#ea4b12] hover:bg-[#d03e0b] disabled:bg-slate-300 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-md"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Đang tạo...</span>
                  </span>
                ) : (
                  <span>Tạo Tài Khoản Shop</span>
                )}
              </button>
            </form>

            {onBack && (
              <button onClick={onBack} className="w-full text-center text-xs text-slate-500 hover:text-slate-700 font-medium">
                ← Quay lại
              </button>
            )}
          </div>
        )}

        {step === 'FORBIDDEN' && (
          <div className="bg-white py-10 px-6 shadow-xl rounded-3xl border border-red-200 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto">
              <ShieldCheck className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-extrabold text-slate-900">Không Có Quyền</h3>
            <p className="text-sm text-slate-600">{generalError}</p>
            <button onClick={() => setStep('FORM')} className="text-sm text-[#ea4b12] font-bold hover:underline">Thử lại</button>
          </div>
        )}

        {step === 'SUCCESS' && createdData && (
          <div className="bg-white py-10 px-6 shadow-xl rounded-3xl border border-emerald-200 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <h3 className="text-xl font-extrabold text-slate-900">Tạo Thành Công</h3>
            <div className="text-left bg-slate-50 p-4 rounded-xl text-xs space-y-1 font-mono text-slate-700">
              <p>Merchant ID: {createdData.merchant_id}</p>
              <p>Merchant Code: {createdData.merchant_code}</p>
              <p>User ID: {createdData.user_id}</p>
              <p>Status: active</p>
            </div>
            <p className="text-xs text-slate-500">Tài khoản đã ACTIVE. Vui lòng thông báo mật khẩu cho chủ shop qua kênh an toàn.</p>
            {onBack && (
              <button onClick={onBack} className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2">
                <span>Tiếp tục</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};