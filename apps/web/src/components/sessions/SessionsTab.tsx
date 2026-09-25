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
  id: string;
  user_id: string;
  user_name: string;
  device: string;
  last_active: string;
  is_revoked: boolean;
}

interface SessionsTabProps {
  onToast?: (msg: string) => void;
}

type FetchState = 'loading' | 'error' | 'forbidden' | 'success';

export function SessionsTab({ onToast }: SessionsTabProps) {
  const { user, merchant } = useAuth();
  const [fetchState, setFetchState] = useState<FetchState>('loading');
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [revokeAllOpen, setRevokeAllOpen] = useState(false);
  const [revokeAllLoading, setRevokeAllLoading] = useState(false);
  const [lookupId, setLookupId] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupResult, setLookupResult] = useState<SessionItem | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  // Nothing here sets state before the first await. The effect below calls this
  // on mount, and a setState reached synchronously from an effect — even one
  // behind a flag the compiler cannot prove false — is the cascading render the
  // lint rule refuses. Announcing "loading" is the caller's job: on mount the
  // component already starts there, and a manual refresh says so itself, because
  // by then the previous list is still on screen.
  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions');
      if (res.status === 403) {
        setFetchState('forbidden');
        return;
      }
      if (!res.ok) {
        setFetchState('error');
        return;
      }
      const data = await res.json();
      if (data.success) {
        setSessions(data.data || []);
        setFetchState('success');
      } else {
        setFetchState('error');
      }
    } catch {
      setFetchState('error');
    }
  }, []);

  useEffect(() => {
    // Fetch-on-mount: the list has to come from the server before anything can
    // be shown, and every state this sets lands after the await. Same exemption
    // and same reason as ShipmentListTab and ThreeLedgersTab.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void fetchSessions();
  }, [fetchSessions]);

  const activeSessions = sessions.filter((s) => !s.is_revoked);
  const hasActiveSessions = activeSessions.length > 0;

  const safetyCheck = () => {
    const otherActive = activeSessions.filter((s) => s.id !== 'dev_current');
    return otherActive.length === 0;
  };

  const [revokeLoadingId, setRevokeLoadingId] = useState<string | null>(null);

  const handleRevokeSession = async (sessionId: string) => {
    setRevokeLoadingId(sessionId);
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
      if (res.ok) {
        onToast?.('Session revoked');
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, is_revoked: true } : s))
        );
      } else {
        onToast?.('Revoke failed - please try again');
      }
    } catch {
      onToast?.('Network error');
    } finally {
      setRevokeLoadingId(null);
    }
  };

  const handleRevokeAll = async () => {
    if (safetyCheck()) {
      onToast?.('Warning: cannot revoke - this is the only active session');
      setRevokeAllOpen(false);
      return;
    }
    setRevokeAllLoading(true);
    try {
      const res = await fetch('/api/sessions/revoke-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ include_current: false }),
      });
      if (res.ok) {
        const data = await res.json();
        onToast?.('Revoked ' + data.revoked_count + ' sessions');
        setRevokeAllOpen(false);
        setFetchState('loading');
        void fetchSessions();
      } else {
        onToast?.('Revoke failed - please try again');
      }
    } catch {
      onToast?.('Network error');
    } finally {
      setRevokeAllLoading(false);
    }
  };

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLookupError(null);
    setLookupResult(null);
    if (!lookupId.trim()) {
      setLookupError('Please enter a session ID');
      return;
    }
    if (lookupId.trim().length < 3) {
      setLookupError('Session ID must be at least 3 characters');
      return;
    }
    setLookupLoading(true);
    try {
      const res = await fetch('/api/sessions?status=active');
      if (res.ok) {
        const data = await res.json();
        const found = (data.data || []).find(
          (s: SessionItem) => s.id.toLowerCase() === lookupId.trim().toLowerCase()
        );
        if (found) setLookupResult(found);
        else setLookupError('Session not found: ' + lookupId.trim());
      } else {
        setLookupError('Cannot lookup session');
      }
    } catch {
      setLookupError('Network error');
    } finally {
      setLookupLoading(false);
    }
  };

  // LOADING STATE
  if (fetchState === 'loading') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-[#EA4B12] animate-spin" />
          <span className="font-black text-lg text-slate-900">Loading sessions...</span>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl animate-pulse"
            >
              <div className="w-10 h-10 rounded-lg bg-slate-200" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-slate-200 rounded w-1/3" />
                <div className="h-3 bg-slate-200 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // FORBIDDEN STATE
  if (fetchState === 'forbidden') {
    return (
      <div className="space-y-4">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
            <Lock className="w-7 h-7 text-red-600" />
          </div>
          <h2 className="text-xl font-black text-red-800 mb-2">Access Denied</h2>
          <p className="text-sm text-red-700 font-medium mb-1">
            You do not have permission to view sessions.
          </p>
          <p className="text-xs text-red-500">Session belongs to another user or store.</p>
          {merchant && <p className="text-xs text-red-400 mt-2 font-mono">Store: {merchant.id}</p>}
          <button
            type="button"
            onClick={() => {
              // This button only set 'loading' and never fetched, so the
              // forbidden screen turned into a spinner that nothing would ever
              // resolve. Retry has to retry.
              setFetchState('loading');
              void fetchSessions();
            }}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-xs font-bold cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      </div>
    );
  }

  // ERROR STATE
  if (fetchState === 'error') {
    return (
      <div className="space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-8 text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-amber-100 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-amber-600" />
          </div>
          <h2 className="text-xl font-black text-amber-800 mb-2">Failed to load sessions</h2>
          <p className="text-sm text-amber-700 font-medium mb-4">
            An error occurred while fetching sessions. Please check your connection and try again.
          </p>
          <button
            type="button"
            onClick={() => {
              setFetchState('loading');
              void fetchSessions();
            }}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#EA4B12] hover:bg-[#c93a0a] text-white rounded-xl text-sm font-bold cursor-pointer shadow-sm"
          >
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      </div>
    );
  }

  // EMPTY STATE
  if (fetchState === 'success' && sessions.length === 0) {
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
            <ShieldCheck className="w-8 h-8 text-slate-400" />
          </div>
          <h2 className="text-xl font-black text-slate-800 mb-2">No sessions yet</h2>
          <p className="text-sm text-slate-500 font-medium mb-6">
            Session list is empty. New login devices will appear here.
          </p>
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 rounded-lg text-xs text-slate-500 font-semibold">
            <ShieldCheck className="w-3.5 h-3.5" /> Sessions auto-create on new login
          </div>
        </div>
      </div>
    );
  }

  // SUCCESS STATE
  return (
    <div className="space-y-5">
      {/* Summary Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-6 h-6 text-[#EA4B12]" />
            <div>
              <h1 className="text-xl font-black text-slate-900">Session Management</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {activeSessions.length} active / {sessions.length} total
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setRevokeAllOpen(true)}
            disabled={!hasActiveSessions || safetyCheck()}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-50 hover:bg-red-100 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed text-red-700 rounded-xl text-sm font-bold transition cursor-pointer border border-red-200 disabled:border-slate-200"
          >
            <Trash2 className="w-4 h-4" /> Revoke All
          </button>
        </div>
      </div>

      {/* Session Lookup */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <h3 className="text-sm font-black text-slate-800 mb-3 flex items-center gap-2">
          <Search className="w-4 h-4 text-[#EA4B12]" /> Lookup Session by ID
        </h3>
        <form onSubmit={handleLookup} className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 flex gap-2">
            <input
              type="text"
              value={lookupId}
              onChange={(e) => {
                setLookupId(e.target.value);
                setLookupError(null);
                setLookupResult(null);
              }}
              placeholder="Enter session ID (e.g. dev_abc123)..."
              className="flex-1 modern-input font-mono text-sm"
            />
            <button
              type="submit"
              disabled={lookupLoading}
              className="px-4 py-2.5 bg-[#EA4B12] hover:bg-[#c93a0a] text-white rounded-xl text-sm font-bold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {lookupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Lookup'}
            </button>
          </div>
        </form>
        {lookupError && (
          <div className="mt-3 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <span className="font-medium">{lookupError}</span>
          </div>
        )}
        {lookupResult && (
          <div className="mt-3 flex items-start gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <div className="font-medium">
              Found: <span className="font-mono">{lookupResult.id}</span> -{' '}
              {lookupResult.is_revoked ? (
                <span className="text-red-600 font-bold">Revoked</span>
              ) : (
                <span className="text-emerald-600 font-bold">Active</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Session List */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-100">
          <h3 className="text-sm font-black text-slate-800">
            Session List ({activeSessions.length} active / {sessions.length} total)
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50">
                <th className="px-5 py-3 text-xs font-black text-slate-600 uppercase tracking-wider">
                  Device
                </th>
                <th className="px-5 py-3 text-xs font-black text-slate-600 uppercase tracking-wider">
                  User
                </th>
                <th className="px-5 py-3 text-xs font-black text-slate-600 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-5 py-3 text-xs font-black text-slate-600 uppercase tracking-wider">
                  Last Active
                </th>
                <th className="px-5 py-3 text-xs font-black text-slate-600 uppercase tracking-wider text-center">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sessions.map((session) => (
                <tr key={session.id} className="hover:bg-slate-50 transition">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                        <ShieldCheck
                          className={`w-4 h-4 ${session.is_revoked ? 'text-slate-400' : 'text-emerald-500'}`}
                        />
                      </div>
                      <span className="text-sm font-semibold text-slate-800">{session.device}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-sm font-medium text-slate-700">{session.user_name}</span>
                  </td>
                  <td className="px-5 py-4">
                    {session.is_revoked ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-50 text-red-700 rounded-full text-xs font-bold">
                        <X className="w-3 h-3" /> Revoked
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold">
                        <CheckCircle2 className="w-3 h-3" /> Active
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-sm text-slate-500 font-medium">
                      {session.last_active}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-center">
                    {!session.is_revoked && (
                      <button
                        type="button"
                        onClick={() => void handleRevokeSession(session.id)}
                        disabled={revokeLoadingId === session.id}
                        className="text-xs font-bold text-red-600 hover:text-red-800 hover:bg-red-50 px-3 py-1.5 rounded-lg transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Revoke this session"
                      >
                        {revokeLoadingId === session.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          'Revoke'
                        )}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Revoke All Modal */}
      {revokeAllOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900">Confirm Revoke</h3>
                <p className="text-xs text-slate-500">Revoke all other sessions</p>
              </div>
            </div>
            {safetyCheck() ? (
              <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <span className="font-medium">
                  This is the only active session. Cannot revoke all.
                </span>
              </div>
            ) : (
              <p className="text-sm text-slate-600">
                This will revoke <strong>{activeSessions.length - 1}</strong> other sessions
                (excluding current). Users on those devices will be logged out.
              </p>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setRevokeAllOpen(false)}
                className="px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRevokeAll}
                disabled={safetyCheck() || revokeAllLoading}
                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition cursor-pointer"
              >
                {revokeAllLoading ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Revoking...
                  </span>
                ) : (
                  'Revoke All'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
