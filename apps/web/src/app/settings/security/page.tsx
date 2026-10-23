'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Key,
  Copy,
  Check,
  Download,
  AlertTriangle,
  ArrowLeft,
  Loader2,
  RefreshCw,
  QrCode,
} from 'lucide-react';

export default function SecuritySettingsPage() {
  const {
    user,
    getMfaStatus,
    startMfaSetup,
    verifyMfaSetup,
    regenerateMfaRecoveryCodes: regenerateRecoveryCodes,
  } = useAuth();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [mfaStatus, setMfaStatus] = useState<'NOT_ENROLLED' | 'PENDING' | 'ACTIVE' | 'RESET'>(
    'NOT_ENROLLED'
  );
  const [isRequired, setIsRequired] = useState(false);
  const [codesRemaining, setCodesRemaining] = useState(0);
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null);

  // Flow views: 'STATUS' | 'SETUP_AUTH' | 'SETUP_VERIFY' | 'SUCCESS_CODES' | 'REGENERATE_MODAL'
  const [view, setView] = useState<
    'STATUS' | 'SETUP_AUTH' | 'SETUP_VERIFY' | 'SUCCESS_CODES' | 'REGENERATE_MODAL'
  >('STATUS');

  // Setup state
  const [passwordInput, setPasswordInput] = useState('');
  const [totpCodeInput, setTotpCodeInput] = useState('');
  const [setupData, setSetupData] = useState<{
    secret_key: string;
    provisioning_uri: string;
    expires_at: string;
    expires_in_seconds: number;
  } | null>(null);

  // Recovery codes display
  const [newRecoveryCodes, setNewRecoveryCodes] = useState<string[]>([]);
  const [confirmedSaved, setConfirmedSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  // Feedback and errors
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; code?: string }>({});

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    const res = await getMfaStatus();
    setLoading(false);
    if (res.success && res.data) {
      setMfaStatus(res.data.status);
      setIsRequired(res.data.required);
      setCodesRemaining(res.data.recovery_codes_remaining);
      setVerifiedAt(res.data.mfa_verified_at);
    } else {
      setErrorMsg(res.error || 'Không thể tải trạng thái xác thực hai yếu tố');
    }
  }, [getMfaStatus]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial MFA status fetch
    void loadStatus();
  }, [loadStatus]);

  const handleStartSetupClick = () => {
    setErrorMsg(null);
    setFieldErrors({});
    setPasswordInput('');
    setView('SETUP_AUTH');
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordInput) {
      setFieldErrors({ password: 'Vui lòng nhập mật khẩu đăng nhập' });
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    setErrorMsg(null);

    const res = await startMfaSetup(passwordInput);
    setSubmitting(false);

    if (res.success && res.data) {
      setSetupData(res.data);
      setTotpCodeInput('');
      setView('SETUP_VERIFY');
    } else {
      setErrorMsg(res.error || 'Xác thực mật khẩu không thành công');
    }
  };

  const handleVerifySetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!totpCodeInput || totpCodeInput.length !== 6) {
      setFieldErrors({ code: 'Vui lòng nhập mã gồm 6 chữ số' });
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    setErrorMsg(null);

    const res = await verifyMfaSetup(totpCodeInput);
    setSubmitting(false);

    if (res.success && res.data?.recovery_codes) {
      setNewRecoveryCodes(res.data.recovery_codes);
      setConfirmedSaved(false);
      setView('SUCCESS_CODES');
      setMfaStatus('ACTIVE');
      setCodesRemaining(10);
    } else {
      setErrorMsg(res.error || 'Mã xác thực không hợp lệ hoặc đã hết hạn');
    }
  };

  const handleRegenerateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: { password?: string; code?: string } = {};
    if (!passwordInput) errors.password = 'Vui lòng nhập mật khẩu';
    if (!totpCodeInput || totpCodeInput.length !== 6) errors.code = 'Vui lòng nhập mã gồm 6 chữ số';
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    setErrorMsg(null);

    const res = await regenerateRecoveryCodes(passwordInput, totpCodeInput);
    setSubmitting(false);

    if (res.success && res.data?.recovery_codes) {
      setNewRecoveryCodes(res.data.recovery_codes);
      setConfirmedSaved(false);
      setView('SUCCESS_CODES');
      setCodesRemaining(10);
    } else {
      setErrorMsg(res.error || 'Không thể tạo lại mã dự phòng');
    }
  };

  const handleCopyCodes = () => {
    const text = newRecoveryCodes.join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadCodes = () => {
    const text =
      `SHIP DỄ - MÃ KHÔI PHỤC DỰ PHÒNG XÁC THỰC HAI YẾU TỐ (MFA)\n` +
      `Tài khoản: ${user?.email || user?.phone || user?.full_name}\n` +
      `Ngày tạo: ${new Date().toLocaleString('vi-VN')}\n\n` +
      `LƯU Ý: Mỗi mã chỉ có giá trị sử dụng một lần duy nhất.\n\n` +
      newRecoveryCodes.map((code, idx) => `${idx + 1}. ${code}`).join('\n') +
      `\n`;

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `shipde-recovery-codes-${Date.now()}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleFinishSaveCodes = () => {
    setView('STATUS');
    setSuccessMsg('Đã lưu mã dự phòng và kích hoạt xác thực hai yếu tố thành công');
    loadStatus();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="flex items-center space-x-3 text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
          <span>Đang tải thông tin bảo mật...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Back Link */}
        <div>
          <Link
            href="/dashboard"
            className="inline-flex items-center text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Quay lại bảng điều khiển
          </Link>
        </div>

        {/* Header */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-3 bg-emerald-50 rounded-lg text-emerald-600">
                <Shield className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">Bảo mật tài khoản</h1>
                <p className="text-sm text-slate-500">
                  Quản lý xác thực hai yếu tố (MFA) và mã khôi phục dự phòng
                </p>
              </div>
            </div>
            {isRequired && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                Bắt buộc cho Chủ shop
              </span>
            )}
          </div>
        </div>

        {/* Global Alert Messages */}
        {errorMsg && (
          <div
            role="alert"
            aria-live="polite"
            className="bg-rose-50 border border-rose-200 rounded-lg p-4 flex items-start space-x-3 text-rose-800 text-sm"
          >
            <AlertTriangle className="w-5 h-5 flex-shrink-0 text-rose-600 mt-0.5" />
            <div>{errorMsg}</div>
          </div>
        )}

        {successMsg && (
          <div
            role="alert"
            aria-live="polite"
            className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-start space-x-3 text-emerald-800 text-sm"
          >
            <Check className="w-5 h-5 flex-shrink-0 text-emerald-600 mt-0.5" />
            <div>{successMsg}</div>
          </div>
        )}

        {/* VIEW: Status Card */}
        {view === 'STATUS' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-6">
            <div className="flex items-start justify-between border-b border-slate-100 pb-5">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Xác thực hai yếu tố (TOTP Authenticator)
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  Bảo vệ tài khoản bằng ứng dụng tạo mã một lần (Google Authenticator, Microsoft
                  Authenticator, v.v.)
                </p>
              </div>
              <div>
                {mfaStatus === 'ACTIVE' ? (
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                    <ShieldCheck className="w-3.5 h-3.5 mr-1" />
                    Đã kích hoạt
                  </span>
                ) : (
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                    <ShieldAlert className="w-3.5 h-3.5 mr-1" />
                    Chưa kích hoạt
                  </span>
                )}
              </div>
            </div>

            {mfaStatus === 'ACTIVE' ? (
              <div className="space-y-4">
                <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-slate-900">
                        Mã khôi phục dự phòng
                      </div>
                      <div className="text-sm text-slate-500 mt-0.5">
                        {codesRemaining > 0
                          ? `Còn lại: ${codesRemaining}/10 mã chưa sử dụng`
                          : 'Đã sử dụng hết mã dự phòng'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setPasswordInput('');
                        setTotpCodeInput('');
                        setFieldErrors({});
                        setErrorMsg(null);
                        setView('REGENERATE_MODAL');
                      }}
                      className="inline-flex items-center px-3 py-2 border border-slate-300 shadow-sm text-sm font-medium rounded-lg text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500"
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Tạo lại mã dự phòng
                    </button>
                  </div>
                </div>

                {codesRemaining <= 2 && codesRemaining > 0 && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                    ⚠️ Bạn chỉ còn {codesRemaining} mã dự phòng. Khuyến nghị tạo lại bộ mã mới để
                    tránh mất quyền truy cập.
                  </div>
                )}
                {codesRemaining === 0 && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800">
                    🚨 Bạn đã dùng hết mã dự phòng! Vui lòng tạo lại bộ mã mới ngay lập tức.
                  </div>
                )}

                {verifiedAt && (
                  <div className="text-xs text-slate-400">
                    Kích hoạt lần cuối vào: {new Date(verifiedAt).toLocaleString('vi-VN')}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-slate-600">
                  Khi đăng nhập, sau khi nhập mật khẩu chính xác, bạn sẽ được yêu cầu nhập thêm mã
                  gồm 6 chữ số từ ứng dụng xác thực trên điện thoại.
                </p>
                <div>
                  <button
                    type="button"
                    onClick={handleStartSetupClick}
                    className="inline-flex items-center px-4 py-2.5 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500"
                  >
                    <Key className="w-4 h-4 mr-2" />
                    Bắt đầu thiết lập MFA
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* VIEW: Step 1 - Re-auth Password */}
        {view === 'SETUP_AUTH' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-5">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Xác nhận mật khẩu</h2>
              <p className="text-sm text-slate-500 mt-1">
                Để bảo vệ an toàn tài khoản, vui lòng xác nhận mật khẩu hiện tại trước khi bắt đầu
                thiết lập MFA.
              </p>
            </div>

            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <label htmlFor="auth-password" className="block text-sm font-medium text-slate-700">
                  Mật khẩu tài khoản
                </label>
                <input
                  id="auth-password"
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  disabled={submitting}
                  className={`mt-1 block w-full px-3 py-2 border rounded-lg shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                    fieldErrors.password ? 'border-rose-300' : 'border-slate-300'
                  }`}
                  placeholder="Nhập mật khẩu hiện tại"
                />
                {fieldErrors.password && (
                  <p className="mt-1 text-xs text-rose-600">{fieldErrors.password}</p>
                )}
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setView('STATUS')}
                  disabled={submitting}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                >
                  {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Tiếp tục
                </button>
              </div>
            </form>
          </div>
        )}

        {/* VIEW: Step 2 - QR and TOTP Verification */}
        {view === 'SETUP_VERIFY' && setupData && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-6">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Quét mã QR ứng dụng Authenticator
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                Mở ứng dụng Google Authenticator hoặc Microsoft Authenticator trên điện thoại và
                quét mã bên dưới.
              </p>
            </div>

            {/* Manual Key Display */}
            <div className="space-y-3 bg-slate-50 p-4 rounded-lg border border-slate-200">
              <div className="flex items-center space-x-2 text-xs font-semibold text-slate-700 uppercase tracking-wider">
                <QrCode className="w-4 h-4 text-emerald-600" />
                <span>Khóa thủ công (nếu không thể quét mã)</span>
              </div>
              <div className="flex items-center justify-between bg-white px-3 py-2 rounded border border-slate-200">
                <code className="text-sm font-mono text-slate-800 break-all select-all font-bold">
                  {setupData.secret_key}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(setupData.secret_key);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="ml-3 p-1.5 text-slate-500 hover:text-emerald-600 transition-colors"
                  title="Sao chép khóa bí mật"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
              <p className="text-xs text-slate-500">
                Thời gian hiệu lực phiên thiết lập: 10 phút. Nếu rời khỏi trang, bạn sẽ cần tạo lại
                khóa mới.
              </p>
            </div>

            {/* Verification Code Form */}
            <form onSubmit={handleVerifySetupSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="verify-totp-code"
                  className="block text-sm font-medium text-slate-700"
                >
                  Nhập mã 6 chữ số từ ứng dụng
                </label>
                <input
                  id="verify-totp-code"
                  type="text"
                  maxLength={6}
                  value={totpCodeInput}
                  onChange={(e) => setTotpCodeInput(e.target.value.replace(/\D/g, ''))}
                  disabled={submitting}
                  className={`mt-1 block w-48 tracking-widest text-center text-xl font-mono px-3 py-2 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                    fieldErrors.code ? 'border-rose-300' : 'border-slate-300'
                  }`}
                  placeholder="000000"
                />
                {fieldErrors.code && (
                  <p className="mt-1 text-xs text-rose-600">{fieldErrors.code}</p>
                )}
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setView('STATUS')}
                  disabled={submitting}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={submitting || totpCodeInput.length !== 6}
                  className="inline-flex items-center px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                >
                  {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Kích hoạt và nhận mã dự phòng
                </button>
              </div>
            </form>
          </div>
        )}

        {/* VIEW: Step 3 - One-time Recovery Codes Display */}
        {view === 'SUCCESS_CODES' && (
          <div className="bg-white rounded-xl shadow-sm border border-emerald-200 p-6 space-y-6">
            <div className="flex items-center space-x-3 text-emerald-700">
              <ShieldCheck className="w-7 h-7" />
              <div>
                <h2 className="text-lg font-bold text-slate-900">Lưu mã dự phòng của bạn</h2>
                <p className="text-sm text-slate-600">
                  Đây là lần duy nhất các mã này được hiển thị đầy đủ. Hãy lưu chúng ở nơi an toàn.
                </p>
              </div>
            </div>

            {/* Codes Grid */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <div className="grid grid-cols-2 gap-3 font-mono text-sm font-bold text-slate-800">
                {newRecoveryCodes.map((code, idx) => (
                  <div
                    key={idx}
                    className="bg-white px-3 py-2 rounded border border-slate-200 text-center"
                  >
                    {code}
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleCopyCodes}
                  className="inline-flex items-center px-3 py-1.5 border border-slate-300 shadow-sm text-xs font-medium rounded-lg text-slate-700 bg-white hover:bg-slate-50"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 mr-1" />
                  )}
                  {copied ? 'Đã sao chép!' : 'Sao chép tất cả'}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadCodes}
                  className="inline-flex items-center px-3 py-1.5 border border-slate-300 shadow-sm text-xs font-medium rounded-lg text-slate-700 bg-white hover:bg-slate-50"
                >
                  <Download className="w-3.5 h-3.5 mr-1" />
                  Tải file văn bản (.txt)
                </button>
              </div>
            </div>

            {/* Mandatory confirmation checkbox */}
            <div className="space-y-4">
              <label className="flex items-start space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmedSaved}
                  onChange={(e) => setConfirmedSaved(e.target.checked)}
                  className="mt-0.5 h-4 w-4 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500"
                />
                <span className="text-sm text-slate-700 select-none">
                  Tôi xác nhận đã lưu 10 mã dự phòng ở nơi an toàn và hiểu rằng tôi sẽ không thể xem
                  lại các mã này sau khi đóng trang.
                </span>
              </label>

              <div>
                <button
                  type="button"
                  disabled={!confirmedSaved}
                  onClick={handleFinishSaveCodes}
                  className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Hoàn tất thiết lập
                </button>
              </div>
            </div>
          </div>
        )}

        {/* VIEW: Regenerate Codes Modal / View */}
        {view === 'REGENERATE_MODAL' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-5">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Tạo lại bộ mã dự phòng mới</h2>
              <p className="text-sm text-slate-500 mt-1">
                Việc tạo mới sẽ lập tức vô hiệu hóa toàn bộ các mã dự phòng cũ chưa sử dụng.
              </p>
            </div>

            <form onSubmit={handleRegenerateSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="regen-password"
                  className="block text-sm font-medium text-slate-700"
                >
                  Mật khẩu hiện tại
                </label>
                <input
                  id="regen-password"
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  disabled={submitting}
                  className={`mt-1 block w-full px-3 py-2 border rounded-lg shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                    fieldErrors.password ? 'border-rose-300' : 'border-slate-300'
                  }`}
                  placeholder="Nhập mật khẩu"
                />
                {fieldErrors.password && (
                  <p className="mt-1 text-xs text-rose-600">{fieldErrors.password}</p>
                )}
              </div>

              <div>
                <label htmlFor="regen-totp" className="block text-sm font-medium text-slate-700">
                  Mã xác thực 6 chữ số từ ứng dụng
                </label>
                <input
                  id="regen-totp"
                  type="text"
                  maxLength={6}
                  value={totpCodeInput}
                  onChange={(e) => setTotpCodeInput(e.target.value.replace(/\D/g, ''))}
                  disabled={submitting}
                  className={`mt-1 block w-48 tracking-widest text-center text-lg font-mono px-3 py-2 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                    fieldErrors.code ? 'border-rose-300' : 'border-slate-300'
                  }`}
                  placeholder="000000"
                />
                {fieldErrors.code && (
                  <p className="mt-1 text-xs text-rose-600">{fieldErrors.code}</p>
                )}
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setView('STATUS')}
                  disabled={submitting}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                >
                  {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Tạo 10 mã mới
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
