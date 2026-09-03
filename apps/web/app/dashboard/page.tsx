'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

type Repository = {
  id: string;
  name: string;
  path: string;
  analyses: Array<{ id: string; score: number; createdAt: string }>;
};

const getSafeError = async (response: Response): Promise<string> => {
  try {
    const data = await response.json();
    if (typeof data?.message === 'string') return data.message;
  } catch {
    return 'Request failed.';
  }
  return 'Request failed.';
};

function classifyRisk(score: number) {
  if (score >= 70) return 'High';
  if (score >= 35) return 'Moderate';
  return 'Low';
}

function scoreColor(score: number) {
  if (score >= 70) return 'text-red-400';
  if (score >= 35) return 'text-amber-400';
  return 'text-green-400';
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function DashboardPage() {
  const { token, user, logout, isLoading } = useAuth();
  const router = useRouter();

  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [repoUrl, setRepoUrl] = useState('');
  const [repoBusy, setRepoBusy] = useState(false);
  const [repoError, setRepoError] = useState('');
  const [analyzeState, setAnalyzeState] = useState('');
  const [analyzingRepoId, setAnalyzingRepoId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    if (!isLoading && !token) {
      router.push('/login');
    }
  }, [token, isLoading, router]);

  useEffect(() => {
    if (token) {
      fetchRepositories(token);
    }
  }, [token]);

  const fetchRepositories = async (accessToken: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/repositories`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (response.ok) {
        const data = await response.json();
        setRepositories(data.repositories ?? []);
      }
    } catch {
      // ignore
    }
  };

  const onDelete = async (id: string, name: string) => {
    if (!token) return;
    if (!window.confirm(`Delete ${name}?\n\nThis will remove the repository and its saved analyses from Change Friction.`)) {
      return;
    }
    setDeletingId(id);
    setDeleteError('');
    try {
      const res = await fetch(`${API_BASE}/api/repositories/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok || res.status === 204) {
        setRepositories(prev => prev.filter(r => r.id !== id));
      } else {
        setDeleteError(await getSafeError(res));
      }
    } catch {
      setDeleteError('Unable to delete repository.');
    } finally {
      setDeletingId(null);
    }
  };

  const onAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !repoUrl) return;

    setRepoBusy(true);
    setRepoError('');
    setAnalyzeState('Connecting to repository...');

    try {
      const derivedName = repoUrl.startsWith('https://github.com/') ? repoUrl.split('/').slice(-1)[0].replace(/\.git$/, '') : '';

      // 1. Create or get repository
      const createRes = await fetch(`${API_BASE}/api/repositories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: derivedName || 'Unnamed', url: repoUrl }),
      });

      if (!createRes.ok) {
        setRepoError(await getSafeError(createRes));
        return;
      }
      const createData = await createRes.json();
      const repoId = createData.repository.id;
      
      // Update UI with newly found repository if it doesn't exist locally
      setRepositories(prev => {
        if (!prev.find(r => r.id === repoId)) return [createData.repository, ...prev];
        return prev;
      });

      setAnalyzingRepoId(repoId);
      setAnalyzeState('Mining Git history & Calculating friction...');

      // 2. Start analysis
      const analyzeRes = await fetch(`${API_BASE}/api/repositories/${encodeURIComponent(repoId)}/analyze`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!analyzeRes.ok) {
        setRepoError(await getSafeError(analyzeRes));
        return;
      }

      const analyzeData = await analyzeRes.json();
      const analysisId = analyzeData.analysisId;

      setAnalyzeState('Preparing results...');
      
      // Navigate to the analysis page
      router.push(`/analysis/${analysisId}`);

    } catch (err) {
      setRepoError('Unable to analyze repository. Network or server error.');
    } finally {
      setRepoBusy(false);
      setAnalyzingRepoId(null);
      setAnalyzeState('');
    }
  };

  const onAnalyzeExisting = async (repoId: string, url: string) => {
    setRepoUrl(url);
    const mockEvent = { preventDefault: () => {} } as React.FormEvent;
    await onAnalyze(mockEvent);
  };

  if (isLoading || !token) {
    return <div className="p-4 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <main className="min-h-screen bg-[#0c0c0e] px-6 py-10 text-slate-200">
      <div className="mx-auto max-w-5xl">
        <header className="mb-12 flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-6">
            <h1 className="text-lg font-bold text-slate-100">Change Friction</h1>
            <span className="text-sm font-medium text-slate-400">Dashboard</span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-slate-400">{user?.email}</span>
            <button onClick={logout} className="text-slate-500 hover:text-slate-300">Logout</button>
          </div>
        </header>

        <section className="mb-16">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-6">Your repositories</h2>
          
          {deleteError && <p className="mb-4 text-sm text-red-400">{deleteError}</p>}
          
          <div className="space-y-4">
            {repositories.length === 0 && (
              <p className="text-sm text-slate-500">No repositories analyzed yet.</p>
            )}
            {repositories.map(repo => {
              const latestAnalysis = repo.analyses?.[0];
              return (
                <div key={repo.id} className="flex flex-col sm:flex-row sm:items-center justify-between border border-slate-800 bg-[#141416] p-4 rounded-md">
                  <div className="mb-4 sm:mb-0">
                    <h3 className="font-semibold text-slate-200">{repo.name}</h3>
                    <p className="text-xs text-slate-500 mt-1">{repo.path.replace('https://', '')}</p>
                    
                    {latestAnalysis ? (
                      <div className="mt-3 text-sm">
                        <span className={scoreColor(latestAnalysis.score)}>{classifyRisk(latestAnalysis.score)}</span>
                        <span className="text-slate-500 mx-2">·</span>
                        <span className="font-medium">{Math.round(latestAnalysis.score)}</span>
                        <p className="text-xs text-slate-500 mt-1">Last analyzed: {formatDate(latestAnalysis.createdAt)}</p>
                      </div>
                    ) : (
                      <p className="text-sm mt-3 text-slate-500">Not analyzed yet</p>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-3">
                    {analyzingRepoId === repo.id ? (
                      <span className="text-sm text-slate-400">Analyzing...</span>
                    ) : (
                      <>
                        {latestAnalysis ? (
                          <Link href={`/analysis/${latestAnalysis.id}`} className="rounded border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800 transition-colors">
                            Open analysis
                          </Link>
                        ) : (
                          <button onClick={() => onAnalyzeExisting(repo.id, repo.path)} className="rounded bg-slate-200 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-white transition-colors">
                            Analyze
                          </button>
                        )}
                        <button 
                          onClick={() => onDelete(repo.id, repo.name)} 
                          disabled={deletingId === repo.id}
                          className="text-sm text-slate-500 hover:text-red-400 transition-colors disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="border-t border-slate-800 pt-12">
          <h2 className="text-lg font-semibold text-slate-100 mb-2">Analyze a repository</h2>
          <p className="text-sm text-slate-400 mb-6 max-w-xl">
            Paste a public GitHub repository URL to find code that is more likely to cause unexpected impact when changed.
          </p>

          <form onSubmit={onAnalyze} className="max-w-2xl">
            <div className="flex gap-3">
              <input
                type="url"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/..."
                required
                disabled={repoBusy}
                className="flex-1 rounded-md border border-slate-700 bg-[#141416] px-4 py-2 text-sm focus:border-slate-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={repoBusy || !repoUrl}
                className="rounded-md bg-slate-200 px-5 py-2 text-sm font-medium text-slate-950 hover:bg-white disabled:opacity-50"
              >
                Analyze repository
              </button>
            </div>
            
            {analyzeState && <p className="mt-4 text-sm text-slate-400">{analyzeState}</p>}
            {repoError && <p className="mt-4 text-sm text-red-400">{repoError}</p>}
          </form>
        </section>
      </div>
    </main>
  );
}
