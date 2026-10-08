'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  ShieldCheck,
  Loader2,
  AlertTriangle,
  AlertCircle,
  Lock,
  CheckCircle2,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';

interface SessionItem {
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

interface SessionsTabProps {
  onToast?: (msg: string) => void;
}

export function SessionsTab({ onToast }: SessionsTabProps) {
  const { token } = useAuth();
  const [fetchState, setFetchState] = useState<'loading' | 'error' | 'forbidden' | 'success'>(
    'loading'
  );
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [revokeAllOpen, setRevokeAllOpen] = useState(false);
  const [revokeAllLoading, setRevokeAllLoading] = useState(false);
  const [revokeAllIncludeCurrent, setRevokeAllIncludeCurrent] = useState(false);

  const fetchSessions = useCallback(async () => {
    if (!token) {
      setFetchState('forbidden');
      return;
    }
    try {
      setFetchState('loading');
      const res = await fetch(
        (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001') + '/api/v1/sessions',
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (res.status === 401 || res.status === 403) {
        setFetchState('forbidden');
        return;
      }
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      setSessions(data.data || []);
      setFetchState('success');
    } catch (err) {
      setFetchState('error');
    }
  }, [token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void fetchSessions();
  }, [fetchSessions]);

  const handleRevoke = async (sessionId: string) => {
    try {
      const res = await fetch(
        (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001') +
          `/api/v1/sessions/${sessionId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (res.ok) {
        onToast?.('Đã thu hồi phiên làm việc');
        setSessions((prev) =>
          prev.map((s) => (s.session_id === sessionId ? { ...s, status: 'REVOKED' } : s))
        );
      } else {
        onToast?.('Thu hồi phiên thất bại');
      }
    } catch (err) {
      onToast?.('Lỗi hệ thống khi thu hồi phiên');
    }
  };

  const handleRevokeAll = async () => {
    setRevokeAllLoading(true);
    try {
      const res = await fetch(
        (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001') +
          '/api/v1/sessions/revoke-all',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ include_current: revokeAllIncludeCurrent }),
        }
      );
      if (res.ok) {
        onToast?.('Đã thu hồi tất cả phiên làm việc được chọn');
        // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
        void fetchSessions();
      } else {
        onToast?.('Thu hồi tất cả phiên thất bại');
      }
    } catch (err) {
      onToast?.('Lỗi hệ thống khi thu hồi tất cả phiên');
    } finally {
      setRevokeAllLoading(false);
      setRevokeAllOpen(false);
    }
  };

  if (fetchState === 'loading' && sessions.length === 0) return <div>Đang tải...</div>;
  if (fetchState === 'forbidden') return <div>Không có quyền truy cập</div>;
  if (fetchState === 'error') {
    return (
      <div className="flex flex-col items-center justify-center p-8 space-y-4 border rounded-md bg-red-50 text-red-700">
        <AlertCircle size={32} />
        <p>Đã xảy ra lỗi khi tải danh sách phiên làm việc.</p>
        <button
          onClick={fetchSessions}
          className="flex items-center gap-2 px-4 py-2 bg-red-100 hover:bg-red-200 rounded-md transition-colors"
        >
          <RefreshCw size={16} /> Thử lại
        </button>
      </div>
    );
  }

  const activeSessions = sessions.filter((s) => s.status === 'ACTIVE');
  const otherActive = activeSessions.filter((s) => !s.is_current);

  return (
    <div className="space-y-6">
      <div className="flex justify-between">
        <h2>Thiết bị đang đăng nhập</h2>
        {activeSessions.length > 1 && (
          <button onClick={() => setRevokeAllOpen(true)}>Đăng xuất thiết bị khác</button>
        )}
      </div>

      {revokeAllOpen && (
        <div className="border p-4">
          <p>Thu hồi {otherActive.length} phiên?</p>
          <input
            type="checkbox"
            checked={revokeAllIncludeCurrent}
            onChange={(e) => setRevokeAllIncludeCurrent(e.target.checked)}
          />{' '}
          Bao gồm phiên hiện tại
          <button onClick={handleRevokeAll}>Xác nhận</button>
          <button onClick={() => setRevokeAllOpen(false)}>Hủy</button>
        </div>
      )}

      {sessions.length === 0 ? (
        <p>Không có phiên nào.</p>
      ) : (
        <ul>
          {sessions.map((session) => (
            <li key={session.session_id}>
              <p>ID: {session.device_id}</p>
              <p>Trạng thái: {session.status}</p>
              <p>Hoạt động: {session.last_active_at}</p>
              <p>IP: {session.ip_address}</p>
              <p>Hết hạn: {session.expires_at}</p>
              <p>Trình duyệt: {session.user_agent}</p>
              {session.is_current && <span>Hiện tại</span>}
              {session.status === 'ACTIVE' && (
                <button onClick={() => handleRevoke(session.session_id)}>Thu hồi</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
