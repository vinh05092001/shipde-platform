'use client';
import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
interface Source {
  id: string | number;
  label: string;
  kind: string;
  servesModels: boolean;
  harness: string;
  endpoint: string;
}

const PaseoPage = () => {
  const { isHydrating, isAuthenticated } = useAuth();
  const [sources, setSources] = useState<Source[]>([]);
  const [harnesses, setHarnesses] = useState<string[]>([]);
  const [writers, setWriters] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 5000);
      const [sourcesRes, harnessesRes, writersRes] = await Promise.all([
        fetch('http://127.0.0.1:6767/sources', { signal: abort.signal }),
        fetch('http://127.0.0.1:6767/harnesses', { signal: abort.signal }),
        fetch('http://127.0.0.1:6767/writers', { signal: abort.signal }),
      ]);
      clearTimeout(timeout);
      if (!sourcesRes.ok) throw new Error('sources');
      if (!harnessesRes.ok) throw new Error('harnesses');
      if (!writersRes.ok) throw new Error('writers');
      const sourcesData = await sourcesRes.json();
      const harnessesData = await harnessesRes.json();
      const writersData = await writersRes.json();
      setSources(Array.isArray(sourcesData) ? (sourcesData as Source[]) : []);
      setHarnesses(
        Array.isArray(harnessesData)
          ? (harnessesData as any[]).map((h) => h.id || h.name || String(h))
          : []
      );
      setWriters(
        typeof writersData === 'number'
          ? writersData
          : Array.isArray(writersData)
            ? writersData.length
            : 0
      );
    } catch (err) {
      console.error('Paseo fetch error:', err);
      setError('Failed to connect to Paseo daemon.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) fetchData();
  }, [isAuthenticated]); // eslint-disable-line -- fetchData is stable; only re-run on auth change

  // During the single-tick localStorage restore, show nothing rather than a
  // loading skeleton that could persist when the user is not signed in.
  // isHydrating resolves to false immediately after the effect runs on the
  // client (BRAIN.md rule 4: a screen must never stay in a loading frame
  // when the user is not signed in).
  if (isHydrating) return null;
  if (!isAuthenticated)
    return (
      <div className="min-h-[20vh] flex flex-col items-center justify-center p-6 text-center">
        <p className="mb-4">
          Please{' '}
          <a href="/login" className="underline text-primary hover:text-primary/80">
            log in
          </a>{' '}
          to view Paseo status.
        </p>
        <p className="text-muted-foreground">
          The Paseo dispatch adapter status requires authentication.
        </p>
      </div>
    );

  return (
    <div className="container mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-bold">Paseo Dispatch Adapter Status</h1>
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-800">{error}</div>
      )}
      {!loading && (
        <>
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Source Registry</h2>
            {sources.length > 0 ? (
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
                  {sources.map((s, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="p-3 text-sm font-mono">{s.id}</td>
                      <td className="p-3 text-sm">{s.label}</td>
                      <td className="p-3 text-sm">{s.kind}</td>
                      <td className="p-3 text-sm text-center">{s.servesModels ? 'Yes' : 'No'}</td>
                      <td className="p-3 text-sm font-mono">{s.harness}</td>
                      <td className="p-3 text-sm break-all max-w-[200px]">{s.endpoint || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-muted-foreground">No source data available.</p>
            )}
          </div>

          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Harness Adapters</h2>
            {harnesses.length > 0 ? (
              <ul className="space-y-1">
                {harnesses.map((h, i) => (
                  <li key={i} className="flex items-center gap-2 p-2 bg-gray-50 rounded-md">
                    <div className="h-2.5 w-2.5 bg-primary rounded"></div>
                    <span className="text-sm font-mono">{h}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">No harness data available.</p>
            )}
          </div>

          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Open Writers</h2>
            <p className="text-lg font-mono">
              {writers} active writer{writers !== 1 ? 's' : ''}
            </p>
            <p className="text-sm text-muted-foreground">
              Number of active decision log writers (sessions).
            </p>
          </div>

          <div className="flex justify-end">
            <button
              onClick={fetchData}
              className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-md transition-colors disabled:opacity-50"
              disabled={loading}
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </>
      )}
      {loading && (
        <div className="flex h-[20vh] items-center justify-center">
          <div className="animate-spin rounded-full border-4 border-primary/20 border-t-primary h-8 w-8"></div>
        </div>
      )}
    </div>
  );
};

export default PaseoPage;
