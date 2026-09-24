'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { AlertCircle, Clock, ShieldAlert, Wifi, WifiOff } from 'lucide-react';

interface Source {
  id: string | number;
  label: string;
  kind: string;
  servesModels: boolean;
  harness: string;
  endpoint: string;
}

type FetchStatus = 'idle' | 'loading' | 'empty' | 'validation' | 'error' | 'forbidden' | 'success';

const PASEO_API_BASE = process.env.NEXT_PUBLIC_PASEO_API_BASE || 'http://127.0.0.1:6767';
const PASEO_TIMEOUT_MS = 5000;

function getTokenScopes(token: string | null): string[] {
  if (!token) return [];
  try {
    const parts = token.split('.');
    if (parts.length < 2) return [];
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    const scope =
      (payload as { scope?: string; scopes?: string[] }).scope ??
      (payload as { scope?: string; scopes?: string[] }).scopes;
    if (typeof scope === 'string') return scope.split(' ').filter(Boolean);
    if (Array.isArray(scope)) return scope.map(String).filter(Boolean);
    return [];
  } catch {
    return [];
  }
}

function asSource(item: unknown): Source | null {
  if (typeof item !== 'object' || item === null) return null;
  const row = item as Record<string, unknown>;
  if (
    (typeof row.id !== 'string' && typeof row.id !== 'number') ||
    typeof row.label !== 'string' ||
    typeof row.kind !== 'string' ||
    typeof row.servesModels !== 'boolean' ||
    typeof row.harness !== 'string'
  ) {
    return null;
  }
  return {
    id: row.id as string | number,
    label: row.label as string,
    kind: row.kind as string,
    servesModels: row.servesModels as boolean,
    harness: row.harness as string,
    endpoint: typeof row.endpoint === 'string' ? row.endpoint : '',
  };
}

const PaseoPage = () => {
  const { isHydrating, isAuthenticated, token } = useAuth();
  const [sources, setSources] = useState<Source[]>([]);
  const [harnesses, setHarnesses] = useState<string[]>([]);
  const [writers, setWriters] = useState(0);
  const [status, setStatus] = useState<FetchStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const hasPaseoAdminScope = isAuthenticated && getTokenScopes(token).includes('paseo.admin');

  const fetchData = async () => {
    if (!isAuthenticated || !hasPaseoAdminScope) return;
    setStatus('loading');
    setMessage(null);
    setSources([]);
    setHarnesses([]);
    setWriters(0);
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), PASEO_TIMEOUT_MS);
    try {
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const [sourcesRes, harnessesRes, writersRes] = await Promise.all([
        fetch(`${PASEO_API_BASE}/sources`, { signal: abort.signal, headers }),
        fetch(`${PASEO_API_BASE}/harnesses`, { signal: abort.signal, headers }),
        fetch(`${PASEO_API_BASE}/writers`, { signal: abort.signal, headers }),
      ]);

      if (sourcesRes.status === 403 || harnessesRes.status === 403 || writersRes.status === 403) {
        setStatus('forbidden');
        setMessage('The Paseo daemon rejected this request (HTTP 403).');
        return;
      }
      if (!sourcesRes.ok || !harnessesRes.ok || !writersRes.ok) {
        setStatus('error');
        setMessage('The Paseo daemon returned an error. Retry when it is reachable.');
        return;
      }

      const sourcesData: unknown = await sourcesRes.json();
      const harnessesData: unknown = await harnessesRes.json();
      const writersData: unknown = await writersRes.json();

      if (!Array.isArray(sourcesData) || !Array.isArray(harnessesData)) {
        setStatus('validation');
        setMessage('The daemon response did not match the expected shape (JSON arrays).');
        return;
      }
      if (typeof writersData !== 'number' && !Array.isArray(writersData)) {
        setStatus('validation');
        setMessage('Writers response did not match the expected shape (number or array).');
        return;
      }

      const parsed: Source[] = [];
      for (const item of sourcesData) {
        const source = asSource(item);
        if (!source) {
          setStatus('validation');
          setMessage('A source row was missing id, label, kind, servesModels or harness.');
          return;
        }
        parsed.push(source);
      }

      const names = harnessesData.map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry === 'object') {
          const row = entry as { id?: unknown; name?: unknown };
          if (row.id != null) return String(row.id);
          if (row.name != null) return String(row.name);
        }
        return String(entry);
      });

      setSources(parsed);
      setHarnesses(names);
      setWriters(typeof writersData === 'number' ? writersData : writersData.length);
      setStatus(parsed.length === 0 && names.length === 0 ? 'empty' : 'success');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setMessage('Paseo daemon request timed out. Verify the daemon is running and retry.');
      } else {
        setMessage('Failed to connect to the Paseo daemon. Verify it is running and retry.');
      }
      setStatus('error');
    } finally {
      clearTimeout(timeout);
    }
  };

  if (isHydrating) return null;

  if (!isAuthenticated) {
    return (
      <div className="min-h-[20vh] flex flex-col items-center justify-center p-6 text-center">
        <WifiOff className="mb-4 h-10 w-10 text-slate-400" />
        <p className="mb-2 text-lg font-semibold">Sign in required</p>
        <p className="text-muted-foreground">
          The Paseo dispatch adapter status requires a signed-in session. Open the console and sign
          in, then return to this page.
        </p>
        <Link href="/" className="mt-4 underline text-primary hover:text-primary/80">
          Go to sign in
        </Link>
      </div>
    );
  }

  if (!hasPaseoAdminScope) {
    return (
      <div className="min-h-[20vh] flex flex-col items-center justify-center p-6 text-center">
        <div className="mb-4 rounded-full bg-red-100 p-3">
          <ShieldAlert className="h-8 w-8 text-red-600" />
        </div>
        <p className="mb-2 text-lg font-semibold">Access denied</p>
        <p className="text-muted-foreground">
          You are signed in but do not have the <code>paseo.admin</code> scope required to view the
          Paseo dispatch adapter status.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Ask an administrator to grant that scope, then sign in again.
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-bold">Paseo Dispatch Adapter Status</h1>

      {status === 'idle' && (
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-md">
          <p className="text-muted-foreground">
            No status has been loaded yet. Load the source registry, harness adapters and open
            writers from the local Paseo daemon.
          </p>
          <button
            type="button"
            onClick={() => void fetchData()}
            className="mt-3 px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-md transition-colors"
          >
            Load status
          </button>
        </div>
      )}

      {status === 'loading' && (
        <div className="flex h-[20vh] flex-col items-center justify-center gap-3" role="status">
          <Clock className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading Paseo status…</p>
        </div>
      )}

      {status === 'validation' && (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-md text-yellow-800">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span className="font-semibold">Data validation error</span>
          </div>
          <p className="mt-1">{message}</p>
          <button
            type="button"
            onClick={() => void fetchData()}
            className="mt-3 px-4 py-2 bg-yellow-100 hover:bg-yellow-200 text-yellow-800 rounded-md transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {status === 'error' && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-800">
          <div className="flex items-center gap-2">
            <Wifi className="h-5 w-5 shrink-0" />
            <span className="font-semibold">Connection error</span>
          </div>
          <p className="mt-1">{message}</p>
          <button
            type="button"
            onClick={() => void fetchData()}
            className="mt-3 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-800 rounded-md transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {status === 'forbidden' && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-800">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 shrink-0" />
            <span className="font-semibold">Forbidden</span>
          </div>
          <p className="mt-1">{message}</p>
          <button
            type="button"
            onClick={() => void fetchData()}
            className="mt-3 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-800 rounded-md transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {(status === 'success' || status === 'empty') && (
        <>
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Sources</h2>
            {sources.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse border border-gray-200">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="p-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        ID
                      </th>
                      <th className="p-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Label
                      </th>
                      <th className="p-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Kind
                      </th>
                      <th className="p-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Serves Models?
                      </th>
                      <th className="p-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Harness
                      </th>
                      <th className="p-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Endpoint
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {sources.map((source) => (
                      <tr key={String(source.id)} className="hover:bg-gray-50">
                        <td className="p-3 text-sm font-mono">{source.id}</td>
                        <td className="p-3 text-sm">{source.label}</td>
                        <td className="p-3 text-sm">{source.kind}</td>
                        <td className="p-3 text-sm text-center">
                          {source.servesModels ? 'Yes' : 'No'}
                        </td>
                        <td className="p-3 text-sm font-mono">{source.harness}</td>
                        <td className="p-3 text-sm break-all max-w-[200px]">
                          {source.endpoint || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-muted-foreground">No sources are registered.</p>
            )}
          </div>

          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Harness Adapters</h2>
            {harnesses.length > 0 ? (
              <ul className="space-y-1">
                {harnesses.map((name) => (
                  <li key={name} className="flex items-center gap-2 p-2 bg-gray-50 rounded-md">
                    <div className="h-2.5 w-2.5 bg-primary rounded"></div>
                    <span className="text-sm font-mono">{name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">No harness adapters are registered.</p>
            )}
          </div>

          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Open Writers</h2>
            <p className="text-lg font-mono">
              {writers} active writer{writers === 1 ? '' : 's'}
            </p>
            {writers === 0 && (
              <p className="text-sm text-muted-foreground">No decision-log writer is open.</p>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void fetchData()}
              className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-md transition-colors"
            >
              Refresh
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default PaseoPage;
