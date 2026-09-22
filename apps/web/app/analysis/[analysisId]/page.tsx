'use client';

import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../../../lib/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { DependencyGraph } from '../../components/DependencyGraph';
import { CoChangeGraph } from '../../components/CoChangeGraph';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

type FileMetrics = {
  dependencyImpact: number;
  changeFrequency: number;
  coChangeCoupling: number;
  contributorComplexity: number;
  historicalRisk: number;
  frictionScore: number;
};

type FileResult = {
  path: string;
  metrics: FileMetrics;
  explanation: string;
  dependencyCount: number;
  dependentCount: number;
  changeCount: number;
  contributorCount: number;
  coChangedWith: string[];
  historicalEvidence: string[];
};

type AnalysisResponse = {
  id: string;
  repositoryId: string;
  score: number;
  files: FileResult[];
  overview: {
    overallScore: number;
    filesAnalyzed: number;
    highFrictionFiles: number;
    mediumFrictionFiles: number;
    lowFrictionFiles: number;
    topHighFrictionModules: string[];
    languages?: Record<string, number>;
  };
  dependencies: Array<{ source: string; dependencies: string[] }>;
  cochanges: Array<{ source: string; target: string; count: number }>;
};

function classifyRisk(score: number) {
  if (score >= 70) return 'HIGH';
  if (score >= 35) return 'MEDIUM';
  return 'LOW';
}

function scoreBadgeStyle(score: number) {
  if (score >= 70) return 'bg-[#FFE3E3] text-[#EF5B5B] border-[#FFC9C9]';
  if (score >= 35) return 'bg-[#FFF4E6] text-[#E05A2B] border-[#FFD8A8]';
  return 'bg-[#EBFBEE] text-[#2B8A3E] border-[#B2F2BB]';
}

function scoreTextColor(score: number) {
  if (score >= 70) return 'text-[#EF5B5B]';
  if (score >= 35) return 'text-[#E05A2B]';
  return 'text-[#2B8A3E]';
}

function getSignalLevel(score: number) {
  if (score >= 70) return 'HIGH';
  if (score >= 35) return 'MEDIUM';
  return 'LOW';
}

export default function AnalysisPage({ params }: { params: { analysisId: string } }) {
  const { token, user, logout, isLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [repoName, setRepoName] = useState<string>('');
  const [error, setError] = useState('');

  const [aiBrief, setAiBrief] = useState<{ whyItMatters: string; whatCouldBeAffected: string[]; beforeYouChangeIt: string[] } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  const [showAllDependents, setShowAllDependents] = useState(false);
  const [showAllDependencies, setShowAllDependencies] = useState(false);
  const [showAllCoChanges, setShowAllCoChanges] = useState(false);

  const selectedFileParam = searchParams.get('file');

  useEffect(() => {
    setAiBrief(null);
    setAiLoading(false);
    setAiError('');
    setShowAllDependents(false);
    setShowAllDependencies(false);
    setShowAllCoChanges(false);
  }, [selectedFileParam]);

  useEffect(() => {
    if (!isLoading && !token) {
      router.push('/login');
    }
  }, [token, isLoading, router]);

  useEffect(() => {
    if (!token) return;
    
    const fetchAnalysis = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/analyses/${encodeURIComponent(params.analysisId)}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) {
          setError('Failed to load analysis.');
          return;
        }
        const data = await res.json();
        setAnalysis(data.analysis);
        
        // Fetch repository name
        const repoRes = await fetch(`${API_BASE}/api/repositories`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (repoRes.ok) {
          const repoData = await repoRes.json();
          const repo = repoData.repositories?.find((r: any) => r.id === data.analysis.repositoryId);
          if (repo) setRepoName(repo.name);
        }
      } catch {
        setError('Error loading analysis.');
      }
    };
    fetchAnalysis();
  }, [params.analysisId, token]);

  const sortedFiles = useMemo(() => {
    if (!analysis?.files) return [];
    return [...analysis.files].sort((a, b) => b.metrics.frictionScore - a.metrics.frictionScore);
  }, [analysis]);

  const selectedFile = useMemo(() => {
    if (!selectedFileParam || !analysis) return null;
    return analysis.files.find(f => f.path === selectedFileParam) || null;
  }, [selectedFileParam, analysis]);

  const handleSelectFile = (path: string) => {
    router.push(`/analysis/${params.analysisId}?file=${encodeURIComponent(path)}`);
  };

  const handleGenerateAiBrief = async () => {
    if (!selectedFile || !token || aiLoading) return;
    setAiLoading(true);
    setAiError('');
    try {
      const encodedPath = encodeURIComponent(selectedFile.path);
      const res = await fetch(`${API_BASE}/api/analyses/${encodeURIComponent(params.analysisId)}/files/${encodedPath}/ai-brief`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        setAiError('Local AI is unavailable. Start Ollama and try again.');
        setAiLoading(false);
        return;
      }
      const data = await res.json();
      if (data.brief) {
        setAiBrief(data.brief);
      } else {
        setAiError('Local AI is unavailable. Start Ollama and try again.');
      }
    } catch {
      setAiError('Local AI is unavailable. Start Ollama and try again.');
    } finally {
      setAiLoading(false);
    }
  };

  if (isLoading || (!analysis && !error)) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex items-center justify-center p-6 text-[#6B6265] text-sm">
        Loading analysis...
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex items-center justify-center p-6">
        <div className="p-4 rounded-xl border border-[#FFC9C9] bg-[#FFE3E3] text-sm font-medium text-[#EF5B5B]">
          {error}
        </div>
      </div>
    );
  }

  if (!analysis) return null;

  const { overview } = analysis;
  const displayName = user?.name ? `Hi, ${user.name.split(' ')[0]}` : user?.email;

  // View: File Detail
  if (selectedFile) {
    // 1. Direct Dependents: Files that import or depend on the selected file
    const dependentPaths = new Set<string>();
    const allDirectDependents: Array<{ path: string; file?: FileResult; score?: number }> = [];
    for (const d of analysis.dependencies || []) {
      if (d.dependencies && d.dependencies.includes(selectedFile.path) && !dependentPaths.has(d.source)) {
        dependentPaths.add(d.source);
        const f = analysis.files.find(file => file.path === d.source);
        allDirectDependents.push({
          path: d.source,
          file: f,
          score: f?.metrics?.frictionScore
        });
      }
    }
    allDirectDependents.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

    // 2. Direct Dependencies: Files imported or used by the selected file
    const directDepEntry = (analysis.dependencies || []).find(d => d.source === selectedFile.path);
    const rawDepPaths = directDepEntry?.dependencies || [];
    const allDirectDependencies: Array<{ path: string; file?: FileResult; score?: number }> = [];
    const seenDepPaths = new Set<string>();
    for (const p of rawDepPaths) {
      if (!seenDepPaths.has(p)) {
        seenDepPaths.add(p);
        const f = analysis.files.find(file => file.path === p);
        allDirectDependencies.push({
          path: p,
          file: f,
          score: f?.metrics?.frictionScore
        });
      }
    }
    allDirectDependencies.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

    // 3. Historical Co-Changes: Files that historically changed together with the selected file
    const coChangeCounts = new Map<string, number>();
    for (const c of (analysis.cochanges || [])) {
      if (c.source === selectedFile.path && c.target && c.target !== selectedFile.path) {
        coChangeCounts.set(c.target, Math.max(coChangeCounts.get(c.target) ?? 0, c.count));
      } else if (c.target === selectedFile.path && c.source && c.source !== selectedFile.path) {
        coChangeCounts.set(c.source, Math.max(coChangeCounts.get(c.source) ?? 0, c.count));
      }
    }
    for (const p of (selectedFile.coChangedWith || [])) {
      if (p !== selectedFile.path && !coChangeCounts.has(p)) {
        coChangeCounts.set(p, 1);
      }
    }
    const allHistoricalCoChanges: Array<{ path: string; count: number; file?: FileResult; score?: number }> = [];
    for (const [p, count] of coChangeCounts.entries()) {
      const f = analysis.files.find(file => file.path === p);
      allHistoricalCoChanges.push({
        path: p,
        count,
        file: f,
        score: f?.metrics?.frictionScore
      });
    }
    allHistoricalCoChanges.sort((a, b) => b.count - a.count || ((b.score ?? -1) - (a.score ?? -1)));

    const visibleDependents = showAllDependents ? allDirectDependents : allDirectDependents.slice(0, 5);
    const visibleDependencies = showAllDependencies ? allDirectDependencies : allDirectDependencies.slice(0, 5);
    const visibleCoChanges = showAllCoChanges ? allHistoricalCoChanges : allHistoricalCoChanges.slice(0, 5);


    let matterReason = '';
    if (selectedFile.dependentCount > 0 && selectedFile.changeCount > 0) {
      matterReason = `This file is relied upon by ${selectedFile.dependentCount} other modules and changes frequently. A change here could have wide-reaching effects, so related modules should be tested before merging.`;
    } else if (selectedFile.dependentCount > 0) {
      matterReason = `This file is relied upon by ${selectedFile.dependentCount} other modules. A change here could affect core functionality, so related modules should be tested before merging.`;
    } else if (selectedFile.changeCount > 0) {
      matterReason = `This file changes frequently. Changes here may be complex or prone to conflicts, so review recent history before modifying.`;
    } else {
      matterReason = `This file has relatively low historical friction, but standard testing is still recommended.`;
    }
    
    const evidenceSentence = `Why we think this: ${selectedFile.dependentCount} modules depend on this file, and it has changed ${selectedFile.changeCount} times in repository history.`;

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
              <Link href={`/analysis/${params.analysisId}`} className="text-xs font-semibold uppercase tracking-wider text-[#6B6265] border-l border-[#E6E1D8] pl-6 hover:text-[#FF6B35] transition-colors">
                ← {repoName || 'Back to Overview'}
              </Link>
            </div>

            <div className="flex items-center gap-5 text-sm">
              <span className="font-semibold text-xs text-[#2E282A]">{displayName}</span>
              <button onClick={logout} className="text-xs font-medium text-[#6B6265] hover:text-[#2E282A] transition-colors">
                Logout
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-6 py-10">
          {/* FILE HEADER BANNER */}
          <div className="bg-white border border-[#E6E1D8] rounded-2xl p-6 md:p-8 shadow-sm mb-8">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
              <div>
                <span className="text-xs font-semibold text-[#6B6265] uppercase tracking-wider">{repoName || 'Repository File'}</span>
                <h1 className="text-2xl font-bold text-[#2E282A] break-all mt-1">{selectedFile.path}</h1>
              </div>
              <div className="text-left md:text-right shrink-0">
                <div className={`inline-block px-3 py-1 rounded-md border text-xs font-semibold uppercase ${scoreBadgeStyle(selectedFile.metrics.frictionScore)}`}>
                  {classifyRisk(selectedFile.metrics.frictionScore)} RISK
                </div>
                <div className={`text-4xl font-bold mt-2 ${scoreTextColor(selectedFile.metrics.frictionScore)}`}>
                  {Math.round(selectedFile.metrics.frictionScore)}<span className="text-lg text-[#9E9497] font-normal">/100</span>
                </div>
              </div>
            </div>
          </div>

          {/* LOCAL AI CONTROL */}
          <div className="mb-10 rounded-2xl border border-[#E6E1D8] bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <button
                  onClick={handleGenerateAiBrief}
                  disabled={aiLoading}
                  className="rounded-lg bg-[#FF6B35] px-4 py-2 text-xs font-semibold text-white hover:bg-[#E05A2B] transition-colors disabled:opacity-50 shadow-sm"
                >
                  {aiLoading ? 'Generating local AI brief...' : 'Generate AI Brief'}
                </button>
                <span className="text-xs text-[#6B6265]">
                  Runs locally with Qwen3 4B
                </span>
              </div>
              {aiBrief && (
                <span className="text-[11px] font-mono font-semibold px-2.5 py-1 rounded-md border border-[#E6E1D8] bg-[#F4F0EA] text-[#6B6265]">
                  AI-generated locally
                </span>
              )}
            </div>
            {aiLoading && (
              <p className="mt-2.5 text-xs text-[#6B6265]">
                Analyzing the file locally — this may take a few seconds.
              </p>
            )}
            {aiError && (
              <p className="mt-3 text-xs text-[#EF5B5B] font-medium">{aiError}</p>
            )}
          </div>

          {/* DECISION AREA */}
          <div className="grid gap-8 md:grid-cols-2 mb-10">
            {/* WHY THIS MATTERS */}
            <section className="bg-white border border-[#E6E1D8] rounded-2xl p-6 shadow-sm">
              <h2 className="text-xs font-semibold text-[#6B6265] uppercase tracking-wider mb-3">Why this matters</h2>
              <p className="text-sm text-[#2E282A] leading-relaxed mb-3">
                {matterReason}
              </p>
              <p className="text-xs text-[#6B6265] italic">
                {evidenceSentence}
              </p>

              {aiBrief?.whyItMatters && (
                <div className="mt-5 pt-4 border-t border-[#E6E1D8]">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-[#2E282A] uppercase tracking-wider">AI interpretation</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-[#E6E1D8] bg-[#F4F0EA] text-[#6B6265]">AI-generated locally</span>
                  </div>
                  <p className="text-xs text-[#6B6265] leading-relaxed">
                    {aiBrief.whyItMatters}
                  </p>
                </div>
              )}
            </section>

            {/* BEFORE YOU CHANGE THIS FILE */}
            <section className="bg-white border border-[#E6E1D8] rounded-2xl p-6 shadow-sm">
              <h2 className="text-xs font-semibold text-[#6B6265] uppercase tracking-wider mb-4">Before you change this file</h2>
              <ul className="space-y-2.5 text-xs text-[#2E282A]">
                {selectedFile.dependentCount > 0 && <li className="flex items-start gap-2.5"><span className="text-[#2B8A3E] font-bold">✓</span> Review {selectedFile.dependentCount} dependent modules before merging</li>}
                {selectedFile.changeCount > 0 && <li className="flex items-start gap-2.5"><span className="text-[#2B8A3E] font-bold">✓</span> Check recent Git history for context on frequent changes</li>}
                {allHistoricalCoChanges.length > 0 && <li className="flex items-start gap-2.5"><span className="text-[#2B8A3E] font-bold">✓</span> Review {allHistoricalCoChanges.length} historical co-change relations</li>}
                <li className="flex items-start gap-2.5"><span className="text-[#2B8A3E] font-bold">✓</span> Run all relevant unit and integration tests</li>
              </ul>

              {aiBrief?.beforeYouChangeIt && aiBrief.beforeYouChangeIt.length > 0 && (
                <div className="mt-5 pt-4 border-t border-[#E6E1D8]">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-[#2E282A] uppercase tracking-wider">AI recommendations</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-[#E6E1D8] bg-[#F4F0EA] text-[#6B6265]">AI-generated locally</span>
                  </div>
                  <ul className="space-y-2 text-xs text-[#6B6265]">
                    {aiBrief.beforeYouChangeIt.map((rec, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-[#FF6B35] font-bold">•</span>
                        <span>{rec}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </div>

          {/* CHANGE IMPACT */}
          <section className="bg-white border border-[#E6E1D8] rounded-2xl p-6 md:p-8 shadow-sm mb-12">
            <div className="mb-6">
              <h2 className="text-base font-bold text-[#2E282A] tracking-tight">Change Impact</h2>
              <p className="text-xs text-[#6B6265] mt-1 max-w-2xl leading-relaxed">
                Overview of modules and files that could be affected if you modify this file, based on direct code architecture and historical commit patterns.
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              {/* 1. DIRECT DEPENDENTS */}
              <div className="flex flex-col rounded-xl border border-[#E6E1D8] bg-[#FAF8F5]/60 p-4">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold text-[#2E282A] uppercase tracking-wider">Direct Dependents</span>
                  <span className="text-[11px] font-semibold text-[#6B6265] bg-white border border-[#E6E1D8] px-2 py-0.5 rounded-full">
                    {allDirectDependents.length}
                  </span>
                </div>
                <p className="text-[11px] text-[#6B6265] mb-3 leading-snug">
                  Files that import or depend on this file.
                </p>
                {allDirectDependents.length > 0 ? (
                  <div className="space-y-2 flex-1">
                    <ul className="space-y-1.5">
                      {visibleDependents.map(item => (
                        <li key={item.path} className="flex justify-between items-center border border-[#E6E1D8] rounded-lg p-2 bg-white hover:border-[#D6D0C5] transition-colors">
                          <button
                            onClick={() => handleSelectFile(item.path)}
                            className="text-xs font-mono text-[#2E282A] truncate mr-2 text-left hover:text-[#FF6B35] transition-colors"
                            title={item.path}
                          >
                            {item.path}
                          </button>
                          {item.score !== undefined && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold uppercase shrink-0 ${scoreBadgeStyle(item.score)}`}>
                              {classifyRisk(item.score)} · {Math.round(item.score)}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                    {allDirectDependents.length > 5 && (
                      <button
                        onClick={() => setShowAllDependents(!showAllDependents)}
                        className="text-[11px] font-semibold text-[#FF6B35] hover:text-[#E05A2B] pt-1 transition-colors"
                      >
                        {showAllDependents ? 'Show fewer' : `View all ${allDirectDependents.length} files`}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center p-4 border border-dashed border-[#E6E1D8] rounded-lg bg-white/50 text-center">
                    <p className="text-xs text-[#9E9497] italic">No data available</p>
                  </div>
                )}
              </div>

              {/* 2. DIRECT DEPENDENCIES */}
              <div className="flex flex-col rounded-xl border border-[#E6E1D8] bg-[#FAF8F5]/60 p-4">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold text-[#2E282A] uppercase tracking-wider">Direct Dependencies</span>
                  <span className="text-[11px] font-semibold text-[#6B6265] bg-white border border-[#E6E1D8] px-2 py-0.5 rounded-full">
                    {allDirectDependencies.length}
                  </span>
                </div>
                <p className="text-[11px] text-[#6B6265] mb-3 leading-snug">
                  Files imported or used by this file.
                </p>
                {allDirectDependencies.length > 0 ? (
                  <div className="space-y-2 flex-1">
                    <ul className="space-y-1.5">
                      {visibleDependencies.map(item => (
                        <li key={item.path} className="flex justify-between items-center border border-[#E6E1D8] rounded-lg p-2 bg-white hover:border-[#D6D0C5] transition-colors">
                          <button
                            onClick={() => handleSelectFile(item.path)}
                            className="text-xs font-mono text-[#2E282A] truncate mr-2 text-left hover:text-[#FF6B35] transition-colors"
                            title={item.path}
                          >
                            {item.path}
                          </button>
                          {item.score !== undefined && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold uppercase shrink-0 ${scoreBadgeStyle(item.score)}`}>
                              {classifyRisk(item.score)} · {Math.round(item.score)}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                    {allDirectDependencies.length > 5 && (
                      <button
                        onClick={() => setShowAllDependencies(!showAllDependencies)}
                        className="text-[11px] font-semibold text-[#FF6B35] hover:text-[#E05A2B] pt-1 transition-colors"
                      >
                        {showAllDependencies ? 'Show fewer' : `View all ${allDirectDependencies.length} files`}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center p-4 border border-dashed border-[#E6E1D8] rounded-lg bg-white/50 text-center">
                    <p className="text-xs text-[#9E9497] italic">No data available</p>
                  </div>
                )}
              </div>

              {/* 3. HISTORICAL CO-CHANGES */}
              <div className="flex flex-col rounded-xl border border-[#E6E1D8] bg-[#FAF8F5]/60 p-4">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold text-[#2E282A] uppercase tracking-wider">Historical Co-Changes</span>
                  <span className="text-[11px] font-semibold text-[#6B6265] bg-white border border-[#E6E1D8] px-2 py-0.5 rounded-full">
                    {allHistoricalCoChanges.length}
                  </span>
                </div>
                <p className="text-[11px] text-[#6B6265] mb-3 leading-snug">
                  Files historically changed together in Git history.
                </p>
                {allHistoricalCoChanges.length > 0 ? (
                  <div className="space-y-2 flex-1">
                    <ul className="space-y-1.5">
                      {visibleCoChanges.map(item => (
                        <li key={item.path} className="flex justify-between items-center border border-[#E6E1D8] rounded-lg p-2 bg-white hover:border-[#D6D0C5] transition-colors">
                          <button
                            onClick={() => handleSelectFile(item.path)}
                            className="text-xs font-mono text-[#2E282A] truncate mr-2 text-left hover:text-[#FF6B35] transition-colors"
                            title={item.path}
                          >
                            {item.path}
                          </button>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[10px] px-1.5 py-0.5 rounded border border-[#E6E1D8] bg-[#F4F0EA] text-[#6B6265] font-mono">
                              {item.count} co-{item.count === 1 ? 'change' : 'changes'}
                            </span>
                            {item.score !== undefined && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold uppercase ${scoreBadgeStyle(item.score)}`}>
                                {classifyRisk(item.score)} · {Math.round(item.score)}
                              </span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                    {allHistoricalCoChanges.length > 5 && (
                      <button
                        onClick={() => setShowAllCoChanges(!showAllCoChanges)}
                        className="text-[11px] font-semibold text-[#FF6B35] hover:text-[#E05A2B] pt-1 transition-colors"
                      >
                        {showAllCoChanges ? 'Show fewer' : `View all ${allHistoricalCoChanges.length} files`}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center p-4 border border-dashed border-[#E6E1D8] rounded-lg bg-white/50 text-center">
                    <p className="text-xs text-[#9E9497] italic">No data available</p>
                  </div>
                )}
              </div>
            </div>

            {aiBrief?.whatCouldBeAffected && aiBrief.whatCouldBeAffected.length > 0 && (
              <div className="mt-8 pt-5 border-t border-[#E6E1D8]">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-[#2E282A] uppercase tracking-wider">AI risk implications</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-[#E6E1D8] bg-[#F4F0EA] text-[#6B6265]">AI-generated locally</span>
                </div>
                <ul className="space-y-2 text-xs text-[#6B6265]">
                  {aiBrief.whatCouldBeAffected.map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-[#FF6B35] font-bold">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-6 pt-4 border-t border-[#F0EDE8] flex items-center justify-between text-[11px] text-[#9E9497]">
              <span>* Historical co-change denotes files committed together in past history, not a code dependency. Modifying this file does not guarantee related files will change.</span>
            </div>
          </section>

          {/* EVIDENCE AREA */}
          <div className="grid gap-8 md:grid-cols-2 mb-12">
            <section className="bg-white border border-[#E6E1D8] rounded-2xl p-6 shadow-sm">
              <h2 className="text-xs font-semibold text-[#6B6265] uppercase tracking-wider mb-4">Why is this {classifyRisk(selectedFile.metrics.frictionScore).toLowerCase()} risk?</h2>
              <ul className="space-y-3.5 text-xs text-[#2E282A]">
                <li className="flex justify-between items-center gap-4">
                  <span className="text-[#6B6265]">Modules depending on this file</span>
                  <span className={`font-bold uppercase ${scoreTextColor(selectedFile.metrics.dependencyImpact)}`}>{getSignalLevel(selectedFile.metrics.dependencyImpact)}</span>
                </li>
                <li className="flex justify-between items-center gap-4 border-t border-[#E6E1D8] pt-3">
                  <span className="text-[#6B6265]">Modification frequency</span>
                  <span className={`font-bold uppercase ${scoreTextColor(selectedFile.metrics.changeFrequency)}`}>{getSignalLevel(selectedFile.metrics.changeFrequency)}</span>
                </li>
                <li className="flex justify-between items-center gap-4 border-t border-[#E6E1D8] pt-3">
                  <span className="text-[#6B6265]">Historical co-change coupling</span>
                  <span className={`font-bold uppercase ${scoreTextColor(selectedFile.metrics.coChangeCoupling)}`}>{getSignalLevel(selectedFile.metrics.coChangeCoupling)}</span>
                </li>
                <li className="flex justify-between items-center gap-4 border-t border-[#E6E1D8] pt-3">
                  <span className="text-[#6B6265]">Contributor complexity</span>
                  <span className={`font-bold uppercase ${scoreTextColor(selectedFile.metrics.contributorComplexity)}`}>{getSignalLevel(selectedFile.metrics.contributorComplexity)}</span>
                </li>
              </ul>
            </section>

            <section className="bg-white border border-[#E6E1D8] rounded-2xl p-6 shadow-sm">
              <h2 className="text-xs font-semibold text-[#6B6265] uppercase tracking-wider mb-4">Technical Evidence</h2>
              <div className="border border-[#E6E1D8] rounded-xl bg-[#FAF8F5] p-4 text-xs font-mono text-[#2E282A] space-y-2.5">
                <p className="flex justify-between"><span>Friction Score:</span> <span className="font-bold">{selectedFile.metrics.frictionScore.toFixed(4)}</span></p>
                <p className="flex justify-between"><span>Dependency Impact:</span> <span>{selectedFile.metrics.dependencyImpact.toFixed(4)}</span></p>
                <p className="flex justify-between"><span>Change Frequency:</span> <span>{selectedFile.metrics.changeFrequency.toFixed(4)}</span></p>
                <p className="flex justify-between"><span>Historical Coupling:</span> <span>{selectedFile.metrics.coChangeCoupling.toFixed(4)}</span></p>
                <p className="flex justify-between"><span>Contributor Spread:</span> <span>{selectedFile.metrics.contributorComplexity.toFixed(4)}</span></p>
                <p className="flex justify-between"><span>Historical Risk:</span> <span>{selectedFile.metrics.historicalRisk.toFixed(4)}</span></p>
              </div>
            </section>
          </div>

          {/* EXPLORE GRAPHS */}
          <section className="space-y-10 pt-8 border-t border-[#E6E1D8]">
            <div className="bg-white border border-[#E6E1D8] rounded-2xl p-6 shadow-sm">
              <h2 className="text-sm font-bold text-[#2E282A] tracking-tight mb-1">Dependency impact</h2>
              <p className="text-xs text-[#6B6265] mb-6">Shows which parts of the codebase depend on this file.</p>
              <div className="h-[420px] border border-[#E6E1D8] rounded-xl bg-[#121214] relative overflow-hidden">
                <DependencyGraph 
                  files={analysis.files} 
                  dependencies={analysis.dependencies} 
                  selectedFilePath={selectedFile.path} 
                  onSelectFile={handleSelectFile} 
                />
              </div>
            </div>

            <div className="bg-white border border-[#E6E1D8] rounded-2xl p-6 shadow-sm">
              <h2 className="text-sm font-bold text-[#2E282A] tracking-tight mb-1">Historical coupling</h2>
              <p className="text-xs text-[#6B6265] mb-6">Shows files that frequently change together with this file.</p>
              <div className="h-[420px] border border-[#E6E1D8] rounded-xl bg-[#121214] relative overflow-hidden">
                <CoChangeGraph 
                  files={analysis.files} 
                  cochanges={analysis.cochanges} 
                  selectedFilePath={selectedFile.path} 
                  onSelectFile={handleSelectFile} 
                />
              </div>
            </div>
          </section>
        </main>
      </div>
    );
  }

  // View: Overview
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
            <Link href="/dashboard" className="text-xs font-semibold uppercase tracking-wider text-[#6B6265] border-l border-[#E6E1D8] pl-6 hover:text-[#FF6B35] transition-colors">
              ← Dashboard
            </Link>
          </div>

          <div className="flex items-center gap-5 text-sm">
            <span className="font-semibold text-xs text-[#2E282A]">{displayName}</span>
            <button onClick={logout} className="text-xs font-medium text-[#6B6265] hover:text-[#2E282A] transition-colors">
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {/* OVERVIEW HERO */}
        <div className="bg-white border border-[#E6E1D8] rounded-2xl p-8 shadow-sm mb-10">
          <h1 className="text-2xl font-bold text-[#2E282A] tracking-tight mb-4">{repoName || 'Repository Overview'}</h1>
          
          <div className="mb-6">
            <p className="text-xs font-semibold text-[#6B6265] uppercase tracking-wider mb-2">Overall change friction score</p>
            <div className="flex items-baseline gap-3">
              <span className={`text-4xl font-bold ${scoreTextColor(overview.overallScore)}`}>{Math.round(overview.overallScore)}</span>
              <span className="text-xl text-[#9E9497]">/ 100</span>
              <span className={`ml-2 px-3 py-1 rounded-md border text-xs font-semibold uppercase ${scoreBadgeStyle(overview.overallScore)}`}>
                {classifyRisk(overview.overallScore)} RISK
              </span>
            </div>
          </div>

          <p className="text-sm text-[#6B6265] max-w-2xl leading-relaxed">
            Most of the repository is relatively stable, but <strong className="text-[#2E282A]">{overview.highFrictionFiles} files</strong> have high change friction and <strong className="text-[#2E282A]">{overview.mediumFrictionFiles} files</strong> have moderate friction. These files should be reviewed carefully before making changes.
          </p>
        </div>

        {/* LANGUAGE BREAKDOWN */}
        {(() => {
          // Prefer server-computed language stats; fall back to deriving from file extensions
          const langMap: Record<string, number> = (() => {
            if (overview.languages && Object.keys(overview.languages).length > 0) {
              return overview.languages;
            }
            // Fallback: infer from analyzed file paths using extension map
            const extMap: Record<string, string> = {
              '.ts': 'TypeScript', '.tsx': 'TypeScript',
              '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
              '.py': 'Python',
              '.java': 'Java',
              '.go': 'Go',
              '.rs': 'Rust',
              '.c': 'C', '.h': 'C',
              '.cpp': 'C++', '.cc': 'C++', '.cxx': 'C++', '.hpp': 'C++',
            };
            const acc: Record<string, number> = {};
            for (const f of analysis.files) {
              const ext = '.' + (f.path.split('.').pop()?.toLowerCase() ?? '');
              const lang = extMap[ext] ?? 'Other';
              acc[lang] = (acc[lang] ?? 0) + 1;
            }
            return acc;
          })();

          const total = Object.values(langMap).reduce((s, n) => s + n, 0);
          if (total === 0) return null;

          // Sort by count descending
          const entries = Object.entries(langMap).sort((a, b) => b[1] - a[1]);

          // Distinct bar colours (rotate through palette)
          const palette = [
            '#FF6B35', '#4C9BE8', '#2B8A3E', '#9B59B6', '#E05A2B',
            '#0891B2', '#D97706', '#DC2626', '#059669', '#7C3AED',
          ];

          return (
            <div className="bg-white border border-[#E6E1D8] rounded-2xl p-6 shadow-sm mb-10">
              <h2 className="text-xs font-semibold text-[#6B6265] uppercase tracking-wider mb-5">Language breakdown</h2>
              <div className="space-y-3">
                {entries.map(([lang, count], i) => {
                  const pct = total > 0 ? (count / total) * 100 : 0;
                  const color = palette[i % palette.length];
                  return (
                    <div key={lang}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-semibold text-[#2E282A]">{lang}</span>
                        <span className="text-xs text-[#6B6265] tabular-nums">
                          {count.toLocaleString()} {count === 1 ? 'file' : 'files'} &middot; {pct.toFixed(1)}%
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-[#F0EDE8] overflow-hidden">
                        <div
                          className="h-2 rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, backgroundColor: color }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-4 text-[11px] text-[#9E9497]">{total.toLocaleString()} source files analyzed</p>
            </div>
          );
        })()}

        {/* FILES LIST */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-semibold text-[#6B6265] uppercase tracking-wider">
              Files needing attention ({sortedFiles.length})
            </h2>
          </div>

          <div className="space-y-3">
            {sortedFiles.length === 0 ? (
              <div className="bg-white border border-[#E6E1D8] rounded-2xl p-8 text-center text-sm text-[#6B6265]">
                No files analyzed or found.
              </div>
            ) : null}
            
            {sortedFiles.slice(0, 50).map((file) => {
              let reason = file.explanation.split('.')[0];
              if (reason) reason += '.';
              
              return (
                <div key={file.path} className="flex flex-col sm:flex-row sm:items-center justify-between bg-white border border-[#E6E1D8] p-5 rounded-xl shadow-sm hover:border-[#D4A5A5] transition-all">
                  <div className="mb-3 sm:mb-0 mr-4">
                    <div className="flex items-center gap-3 mb-1.5">
                      <h3 className="text-sm font-bold text-[#2E282A] truncate max-w-md" title={file.path}>{file.path}</h3>
                      <span className={`text-[10px] px-2.5 py-0.5 rounded border font-semibold uppercase shrink-0 ${scoreBadgeStyle(file.metrics.frictionScore)}`}>
                        {classifyRisk(file.metrics.frictionScore)} · {Math.round(file.metrics.frictionScore)}
                      </span>
                    </div>
                    <p className="text-xs text-[#6B6265] line-clamp-1" title={file.explanation}>
                      {reason}
                    </p>
                  </div>
                  <button 
                    onClick={() => handleSelectFile(file.path)}
                    className="shrink-0 rounded-lg border border-[#E6E1D8] bg-[#FAF8F5] px-4 py-2 text-xs font-semibold text-[#2E282A] hover:bg-white hover:border-[#FF6B35] hover:text-[#FF6B35] transition-colors whitespace-nowrap self-start sm:self-auto"
                  >
                    View details
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
