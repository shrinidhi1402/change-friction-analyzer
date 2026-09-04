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
  if (score >= 70) return 'High Risk';
  if (score >= 35) return 'Medium Risk';
  return 'Low Risk';
}

function getRiskBadgeStyle(score: number) {
  if (score >= 70) {
    return 'bg-[#FFE3E3] text-[#EF5B5B] border-[#FFC9C9]';
  }
  if (score >= 35) {
    return 'bg-[#FFF4E6] text-[#E05A2B] border-[#FFD8A8]';
  }
  return 'bg-[#EBFBEE] text-[#2B8A3E] border-[#B2F2BB]';
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

    } catch {
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
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex items-center justify-center p-6 text-[#6B6265] text-sm">
        Loading dashboard...
      </div>
    );
  }

  const displayName = user?.name ? `Hi, ${user.name.split(' ')[0]}` : user?.email;

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#2E282A]">
      {/* HEADER */}
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur-md border-b border-[#E6E1D8]">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-[#FF6B35] flex items-center justify-center text-white font-bold text-sm shadow-sm">
                CF
              </div>
              <span className="font-bold text-sm tracking-tight text-[#2E282A]">Change Friction Analyzer</span>
            </Link>
            <span className="text-xs font-semibold uppercase tracking-wider text-[#6B6265] border-l border-[#E6E1D8] pl-6">
              Dashboard
            </span>
          </div>

          <div className="flex items-center gap-5 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-[#F4F0EA] border border-[#E6E1D8] flex items-center justify-center text-xs font-bold text-[#2E282A]">
                {(user?.name || user?.email || 'U')[0].toUpperCase()}
              </div>
              <span className="font-semibold text-xs text-[#2E282A]">{displayName}</span>
            </div>
            <button
              onClick={logout}
              className="text-xs font-medium text-[#6B6265] hover:text-[#2E282A] transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="mx-auto max-w-6xl px-6 py-10">
        
        {/* DESKTOP SIDE-BY-SIDE LAYOUT */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* LEFT SIDE: ANALYZE A REPOSITORY */}
          <div className="lg:col-span-5 bg-white border border-[#E6E1D8] rounded-2xl p-6 shadow-sm sticky top-24">
            <div className="mb-6">
              <h2 className="text-lg font-bold text-[#2E282A] tracking-tight">Analyze a repository</h2>
              <p className="text-xs text-[#6B6265] mt-1.5 leading-relaxed">
                Paste a public GitHub repository URL to find files that may be risky to change.
              </p>
            </div>

            <form onSubmit={onAnalyze} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#6B6265] mb-1.5">
                  GitHub Repository URL
                </label>
                <input
                  type="url"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/expressjs/express"
                  required
                  disabled={repoBusy}
                  className="w-full rounded-lg border border-[#E6E1D8] bg-[#FAF8F5] px-3.5 py-2.5 text-sm text-[#2E282A] placeholder-[#9E9497] focus:border-[#FF6B35] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#FF6B35] transition-all"
                />
              </div>

              <button
                type="submit"
                disabled={repoBusy || !repoUrl}
                className="w-full rounded-lg bg-[#FF6B35] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#E05A2B] transition-colors disabled:opacity-50 shadow-sm"
              >
                {repoBusy ? 'Analyzing repository...' : 'Analyze repository'}
              </button>

              {analyzeState && (
                <div className="p-3 rounded-lg bg-[#F4F0EA] border border-[#E6E1D8] text-xs font-medium text-[#2E282A] flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#FF6B35] animate-pulse"></span>
                  <span>{analyzeState}</span>
                </div>
              )}

              {repoError && (
                <div className="p-3 rounded-lg border border-[#FFC9C9] bg-[#FFE3E3] text-xs font-medium text-[#EF5B5B]">
                  {repoError}
                </div>
              )}
            </form>
          </div>

          {/* RIGHT SIDE: YOUR REPOSITORIES */}
          <div className="lg:col-span-7 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#6B6265]">
                Your repositories ({repositories.length})
              </h2>
            </div>

            {deleteError && (
              <div className="p-3 rounded-lg border border-[#FFC9C9] bg-[#FFE3E3] text-xs font-medium text-[#EF5B5B]">
                {deleteError}
              </div>
            )}

            {repositories.length === 0 ? (
              <div className="bg-white border border-[#E6E1D8] rounded-2xl p-8 text-center">
                <p className="text-sm font-medium text-[#6B6265]">No repositories analyzed yet.</p>
                <p className="text-xs text-[#9E9497] mt-1">Paste a GitHub URL on the left to start analyzing.</p>
              </div>
            ) : null}

            {repositories.map(repo => {
              const latestAnalysis = repo.analyses?.[0];
              return (
                <div key={repo.id} className="bg-white border border-[#E6E1D8] rounded-xl p-5 shadow-sm hover:border-[#D4A5A5] transition-all">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div>
                      <h3 className="font-bold text-base text-[#2E282A]">{repo.name}</h3>
                      <p className="text-xs text-[#6B6265] mt-0.5 truncate max-w-sm" title={repo.path}>
                        {repo.path.replace('https://', '')}
                      </p>

                      {latestAnalysis ? (
                        <div className="mt-3 flex items-center gap-3">
                          <span className={`px-2.5 py-0.5 rounded-md border text-xs font-semibold uppercase ${getRiskBadgeStyle(latestAnalysis.score)}`}>
                            {classifyRisk(latestAnalysis.score)}
                          </span>
                          <span className="text-xs font-mono font-bold text-[#2E282A]">
                            Score: {Math.round(latestAnalysis.score)}<span className="text-[#9E9497] font-normal">/100</span>
                          </span>
                          <span className="text-xs text-[#9E9497]">
                            · {formatDate(latestAnalysis.createdAt)}
                          </span>
                        </div>
                      ) : (
                        <p className="text-xs text-[#9E9497] mt-3 italic">Not analyzed yet</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-start">
                      {analyzingRepoId === repo.id ? (
                        <span className="text-xs font-medium text-[#FF6B35]">Analyzing...</span>
                      ) : (
                        <>
                          {latestAnalysis ? (
                            <Link
                              href={`/analysis/${latestAnalysis.id}`}
                              className="rounded-lg border border-[#E6E1D8] bg-[#FAF8F5] px-3.5 py-1.5 text-xs font-semibold text-[#2E282A] hover:bg-white hover:border-[#FF6B35] hover:text-[#FF6B35] transition-colors"
                            >
                              Open analysis
                            </Link>
                          ) : (
                            <button
                              onClick={() => onAnalyzeExisting(repo.id, repo.path)}
                              className="rounded-lg bg-[#FF6B35] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#E05A2B] transition-colors"
                            >
                              Analyze
                            </button>
                          )}
                          <button
                            onClick={() => onDelete(repo.id, repo.name)}
                            disabled={deletingId === repo.id}
                            className="rounded-lg border border-[#E6E1D8] px-3 py-1.5 text-xs font-medium text-[#6B6265] hover:text-[#EF5B5B] hover:border-[#FFC9C9] transition-colors disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      </main>
    </div>
  );
}
