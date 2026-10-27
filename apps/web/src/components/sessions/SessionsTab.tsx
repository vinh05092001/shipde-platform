'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  ShieldCheck,
  Loader2,
  AlertTriangle,
  AlertCircle,
  Lock,
  RefreshCw,
  Trash2,
  X,
  Smartphone,
  Monitor,
  Tablet,
  LogOut,
  Clock,
  Globe,
  Radio,
} from 'lucide-react';

export interface SessionItem {
  session_id: string;
  device_id: string;
  device_model: string | null;
  user_agent: string | null;
  ip_address: string | null;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'INACTIVE';
  last_active_at: string;
  expires_at: string;
  created_at: string;
  is_current: boolean;
}

export interface SessionsTabProps {
  onToast?: (msg: string) => void;
  initialSessions?: SessionItem[];
  initialState?: 'loading' | 'empty' | 'error' | 'forbidden' | 'validation' | 'success';
  initialErrorMessage?: string;
  initialValidationMessage?: string;
  apiUrl?: string;
  authToken?: string;
}

function getDeviceIcon(deviceModel: string | null, userAgent: string | null) {
  const text = `${deviceModel || ''} ${userAgent || ''}`.toLowerCase();
  if (text.includes('ipad') || text.includes('tablet')) {
    return <Tablet className="w-5 h-5 text-indigo-600" />;
  }
  if (
    text.includes('iphone') ||
    text.includes('android') ||
    text.includes('mobile') ||
    text.includes('phone')
  ) {
    return <Smartphone className="w-5 h-5 text-blue-600" />;
  }
  return <Monitor className="w-5 h-5 text-slate-700" />;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function SessionsTab({
  onToast,
  initialSessions,
  initialState,
  initialErrorMessage,
  initialValidationMessage,
  apiUrl,
  authToken,
}: SessionsTabProps) {
  const { token: contextToken } = useAuth();
  const token = authToken !== undefined ? authToken : contextToken;

  const [fetchState, setFetchState] = useState<
    'loading' | 'error' | 'forbidden' | 'validation' | 'success'
  >(initialState === 'empty' ? 'success' : (initialState ?? 'loading'));
  const [sessions, setSessions] = useState<SessionItem[]>(initialSessions ?? []);
  const [errorMessage, setErrorMessage] = useState<string | null>(initialErrorMessage ?? null);
  const [validationMessage, setValidationMessage] = useState<string | null>(
    initialValidationMessage ?? null
  );

  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeAllOpen, setRevokeAllOpen] = useState(false);
  const [revokeAllLoading, setRevokeAllLoading] = useState(false);
  const [revokeAllIncludeCurrent, setRevokeAllIncludeCurrent] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const baseUrl = apiUrl || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

  const fetchSessions = useCallback(async () => {
    if (!token) {
      setFetchState('forbidden');
      return;
    }
    try {
      setFetchState('loading');
      setErrorMessage(null);
      setValidationMessage(null);
      setActionError(null);

      const res = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      if (res.status === 401 || res.status === 403) {
        setFetchState('forbidden');
        return;
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        if (errJson?.error?.code === 'VALIDATION_ERROR') {
          setValidationMessage(errJson.error.message || 'Lỗi kiểm tra dữ liệu');
          setFetchState('validation');
          return;
        }
        throw new Error(errJson?.error?.message || 'Không thể tải danh sách phiên đăng nhập');
      }

      const data = await res.json();
      setSessions(data.data || []);
      setFetchState('success');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Đã xảy ra lỗi khi tải danh sách phiên làm việc.');
      setFetchState('error');
    }
  }, [baseUrl, token]);

  useEffect(() => {
    if (!initialSessions && !initialState) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
      void fetchSessions();
    }
  }, [fetchSessions, initialSessions, initialState]);

  const handleRevoke = async (sessionId: string) => {
    if (revokingId || revokeAllLoading) return; // Prevent duplicate clicks
    setRevokingId(sessionId);
    setActionError(null);

    try {
      const res = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      if (res.status === 401 || res.status === 403) {
        setActionError('Không có quyền thu hồi phiên làm việc này (403 FORBIDDEN).');
        onToast?.('Không có quyền thu hồi phiên làm việc');
        return;
      }

      const resData = await res.json().catch(() => null);

      if (!res.ok) {
        if (
          resData?.error?.code === 'VALIDATION_ERROR' ||
          resData?.error?.code === 'SESSION_NOT_FOUND'
        ) {
          setValidationMessage(resData?.error?.message || 'Không tìm thấy phiên làm việc');
        }
        throw new Error(resData?.error?.message || 'Thu hồi phiên thất bại');
      }

      setSessions((prev) =>
        prev.map((s) => (s.session_id === sessionId ? { ...s, status: 'REVOKED' } : s))
      );
      onToast?.(resData?.message || 'Đã thu hồi 1 phiên làm việc');
    } catch (err: any) {
      setActionError(err?.message || 'Lỗi hệ thống khi thu hồi phiên. Vui lòng thử lại.');
      onToast?.(err?.message || 'Lỗi khi thu hồi phiên');
    } finally {
      setRevokingId(null);
    }
  };

  const handleRevokeAll = async () => {
    if (revokeAllLoading || revokingId) return;
    setRevokeAllLoading(true);
    setActionError(null);

    try {
      const res = await fetch(`${baseUrl}/api/v1/sessions/revoke-all`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        body: JSON.stringify({ include_current: revokeAllIncludeCurrent }),
      });

      if (res.status === 401 || res.status === 403) {
        setActionError('Không có quyền thực hiện thao tác này (403 FORBIDDEN).');
        onToast?.('Không có quyền thu hồi tất cả phiên');
        return;
      }

      const resData = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(resData?.error?.message || 'Thu hồi tất cả phiên thất bại');
      }

      const count = resData?.revoked_count ?? 0;
      onToast?.(resData?.message || `Đã thu hồi ${count} phiên làm việc`);

      if (revokeAllIncludeCurrent) {
        setSessions([]);
        setFetchState('forbidden');
      } else {
        setSessions((prev) => prev.map((s) => (s.is_current ? s : { ...s, status: 'REVOKED' })));
      }
      setRevokeAllOpen(false);
    } catch (err: any) {
      setActionError(err?.message || 'Lỗi hệ thống khi thu hồi tất cả phiên. Vui lòng thử lại.');
      onToast?.(err?.message || 'Lỗi khi thu hồi tất cả phiên');
    } finally {
      setRevokeAllLoading(false);
    }
  };

  // Derive current and remote sessions
  const currentSession = sessions.find((s) => s.is_current);
  const remoteActiveSessions = sessions.filter((s) => !s.is_current && s.status === 'ACTIVE');
  const remoteRevokedSessions = sessions.filter((s) => !s.is_current && s.status !== 'ACTIVE');

  // Loading skeleton component
  const renderLoadingSkeleton = () => (
    <div
      role="status"
      aria-label="Đang tải danh sách thiết bị"
      aria-busy="true"
      data-testid="sessions-loading-skeleton"
      className="space-y-4"
    >
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs animate-pulse">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-slate-200" />
            <div className="space-y-2">
              <div className="w-48 h-4 rounded bg-slate-200" />
              <div className="w-72 h-3 rounded bg-slate-200" />
            </div>
          </div>
          <div className="w-24 h-6 rounded-full bg-slate-200" />
        </div>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs animate-pulse">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-slate-200" />
            <div className="space-y-2">
              <div className="w-40 h-4 rounded bg-slate-200" />
              <div className="w-64 h-3 rounded bg-slate-200" />
            </div>
          </div>
          <button
            type="button"
            disabled
            className="w-20 h-8 rounded-lg bg-slate-200 opacity-50 cursor-not-allowed"
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6" data-testid="sessions-manager">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Radio className="w-5 h-5 text-emerald-600" />
            Quản Lý Phiên Đăng Nhập & Thiết Bị
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Kiểm soát các phiên truy cập trên máy tính, điện thoại và thu hồi phiên từ xa an toàn.
          </p>
        </div>

        {remoteActiveSessions.length > 0 && (
          <button
            type="button"
            data-testid="revoke-all-button"
            disabled={fetchState === 'loading' || revokeAllLoading || revokingId !== null}
            onClick={() => setRevokeAllOpen(true)}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-700 active:bg-red-800 disabled:opacity-50 transition-colors shadow-xs"
          >
            <LogOut className="w-4 h-4" />
            Đăng xuất thiết bị khác ({remoteActiveSessions.length})
          </button>
        )}
      </div>

      {/* Action / Recovery Error Banner */}
      {actionError && (
        <div
          role="alert"
          data-testid="action-error-alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800 flex items-center justify-between gap-3 shadow-xs"
        >
          <div className="flex items-center gap-2.5 text-xs font-medium">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-xs text-red-600 hover:text-red-800 font-medium underline"
          >
            Đóng
          </button>
        </div>
      )}

      {/* Validation Banner */}
      {validationMessage && (
        <div
          role="alert"
          data-testid="validation-alert"
          className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800 flex items-center gap-2.5 text-xs font-medium shadow-xs"
        >
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>{validationMessage}</span>
        </div>
      )}

      {/* Forbidden State */}
      {fetchState === 'forbidden' && (
        <div
          role="alert"
          data-testid="forbidden-alert"
          className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center text-amber-800 space-y-2 shadow-xs"
        >
          <Lock className="w-8 h-8 text-amber-600 mx-auto" />
          <h3 className="text-sm font-bold">Không có quyền truy cập</h3>
          <p className="text-xs text-amber-700">
            Phiên đăng nhập của bạn không có quyền truy cập hoặc đã bị thu hồi. Vui lòng đăng nhập
            lại.
          </p>
        </div>
      )}

      {/* Error State with Recovery Button */}
      {fetchState === 'error' && (
        <div
          role="alert"
          data-testid="error-alert"
          className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-800 space-y-3 shadow-xs"
        >
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            <p className="text-xs font-medium">
              {errorMessage || 'Đã xảy ra lỗi khi tải danh sách phiên làm việc.'}
            </p>
          </div>
          <button
            type="button"
            data-testid="retry-fetch-button"
            onClick={() => void fetchSessions()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-100 hover:bg-red-200 text-red-800 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Thử lại
          </button>
        </div>
      )}

      {/* Loading state */}
      {fetchState === 'loading' && renderLoadingSkeleton()}

      {/* Loaded sessions view */}
      {fetchState !== 'loading' && fetchState !== 'forbidden' && (
        <div className="space-y-6">
          {/* Section 1: Current Active Device */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Thiết Bị Hiện Tại
            </h3>
            {currentSession ? (
              <div
                data-testid="current-session-card"
                className="rounded-xl border-2 border-emerald-500/40 bg-emerald-50/20 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs"
              >
                <div className="flex items-start sm:items-center gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                    {getDeviceIcon(currentSession.device_model, currentSession.user_agent)}
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <strong className="text-xs font-bold text-slate-900">
                        {currentSession.device_model ||
                          currentSession.device_id ||
                          'Trình duyệt hiện tại'}
                      </strong>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                        <ShieldCheck className="w-3 h-3 text-emerald-600" />
                        Thiết bị này
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                      {currentSession.ip_address && (
                        <span className="inline-flex items-center gap-1">
                          <Globe className="w-3 h-3 text-slate-400" />
                          IP: {currentSession.ip_address}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-400" />
                        Hoạt động: {formatDate(currentSession.last_active_at)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-500 italic p-4 rounded-xl border border-slate-200 bg-white">
                Chưa xác định thiết bị hiện tại
              </div>
            )}
          </div>

          {/* Section 2: Remote Devices */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Các Thiết Bị Khác ({remoteActiveSessions.length})
            </h3>

            {/* Empty Remote Sessions State (AC-SESS-03) */}
            {remoteActiveSessions.length === 0 ? (
              <div
                data-testid="empty-remote-sessions"
                className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center space-y-1.5"
              >
                <ShieldCheck className="mx-auto h-8 w-8 text-emerald-500 mb-1" />
                <h4 className="text-xs font-bold text-slate-800">
                  Không có thiết bị đăng nhập nào khác
                </h4>
                <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                  Tài khoản của bạn hiện chỉ đang hoạt động trên thiết bị này. Khi bạn đăng nhập từ
                  điện thoại hoặc máy khác, phiên sẽ xuất hiện tại đây.
                </p>
              </div>
            ) : (
              <div className="space-y-3" data-testid="remote-sessions-list">
                {remoteActiveSessions.map((session) => (
                  <div
                    key={session.session_id}
                    data-testid={`session-card-${session.session_id}`}
                    className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs hover:border-slate-300 transition-colors"
                  >
                    <div className="flex items-start sm:items-center gap-3.5">
                      <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                        {getDeviceIcon(session.device_model, session.user_agent)}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <strong className="text-xs font-bold text-slate-900">
                            {session.device_model || session.device_id}
                          </strong>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                            Đang hoạt động
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                          {session.ip_address && (
                            <span className="inline-flex items-center gap-1 font-mono text-[10px]">
                              <Globe className="w-3 h-3 text-slate-400" />
                              {session.ip_address}
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-400" />
                            Gần nhất: {formatDate(session.last_active_at)}
                          </span>
                          {session.user_agent && (
                            <span
                              className="text-slate-400 max-w-[200px] truncate"
                              title={session.user_agent}
                            >
                              {session.user_agent}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      data-testid={`revoke-btn-${session.session_id}`}
                      disabled={revokingId === session.session_id || revokeAllLoading}
                      onClick={() => handleRevoke(session.session_id)}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-200 bg-red-50/50 text-red-700 hover:bg-red-100 active:bg-red-200 disabled:opacity-50 transition-colors self-end sm:self-center"
                    >
                      {revokingId === session.session_id ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-red-600" />
                          <span>Đang thu hồi...</span>
                        </>
                      ) : (
                        <>
                          <Trash2 className="w-3.5 h-3.5 text-red-600" />
                          <span>Thu hồi</span>
                        </>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Previously Revoked History (if any) */}
            {remoteRevokedSessions.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <details className="text-xs text-slate-500">
                  <summary className="cursor-pointer font-medium hover:text-slate-700">
                    Phiên đã hết hạn hoặc thu hồi trước đó ({remoteRevokedSessions.length})
                  </summary>
                  <div className="mt-2 space-y-2">
                    {remoteRevokedSessions.map((s) => (
                      <div
                        key={s.session_id}
                        className="rounded-lg border border-slate-100 bg-slate-50 p-3 flex items-center justify-between text-[11px] text-slate-400"
                      >
                        <div>
                          <span>{s.device_model || s.device_id}</span>
                          <span className="ml-2 font-mono">{formatDate(s.last_active_at)}</span>
                        </div>
                        <span className="font-semibold text-slate-500">{s.status}</span>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Revoke All Confirmation Modal */}
      {revokeAllOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="revoke-all-modal-title"
          data-testid="revoke-all-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-slate-200 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 id="revoke-all-modal-title" className="text-sm font-bold text-slate-900">
                    Đăng xuất các thiết bị khác
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Hành động này sẽ thu hồi quyền truy cập ngay lập tức.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRevokeAllOpen(false)}
                disabled={revokeAllLoading}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600">
              Bạn có chắc chắn muốn thu hồi <strong>{remoteActiveSessions.length}</strong> phiên
              đăng nhập trên các thiết bị khác không? Các thiết bị đó sẽ phải đăng nhập lại để tiếp
              tục sử dụng.
            </p>

            <label className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-700 cursor-pointer hover:bg-slate-100 transition-colors">
              <input
                type="checkbox"
                data-testid="include-current-checkbox"
                checked={revokeAllIncludeCurrent}
                onChange={(e) => setRevokeAllIncludeCurrent(e.target.checked)}
                className="w-4 h-4 rounded text-red-600 focus:ring-red-500 border-slate-300"
              />
              <span className="font-medium">
                Bao gồm thiết bị hiện tại (Đăng xuất toàn bộ tài khoản)
              </span>
            </label>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setRevokeAllOpen(false)}
                disabled={revokeAllLoading}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                type="button"
                data-testid="confirm-revoke-all-button"
                disabled={revokeAllLoading}
                onClick={handleRevokeAll}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-700 active:bg-red-800 disabled:opacity-50 transition-colors shadow-xs"
              >
                {revokeAllLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Đang thu hồi...</span>
                  </>
                ) : (
                  <span>Xác nhận thu hồi</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
