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
  };
  dependencies: Array<{ source: string; dependencies: string[] }>;
  cochanges: Array<{ source: string; target: string; count: number }>;
};

function classifyRisk(score: number) {
  if (score >= 70) return 'HIGH';
  if (score >= 35) return 'MEDIUM';
  return 'LOW';
}

function scoreColor(score: number) {
  if (score >= 70) return 'text-red-400 border-red-500/30 bg-red-500/10';
  if (score >= 35) return 'text-amber-400 border-amber-500/30 bg-amber-500/10';
  return 'text-green-400 border-green-500/30 bg-green-500/10';
}

function scoreTextColor(score: number) {
  if (score >= 70) return 'text-red-400';
  if (score >= 35) return 'text-amber-400';
  return 'text-green-400';
}

function getSignalLevel(score: number) {
  if (score >= 70) return 'HIGH';
  if (score >= 35) return 'MEDIUM';
  return 'LOW';
}

// Ensure component is unwrapped for the async page prop in Next.js 13+
// Wait, this is a client component, we use React hook style unwrapping or simple props.
export default function AnalysisPage({ params }: { params: { analysisId: string } }) {
  const { token, isLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [repoName, setRepoName] = useState<string>('');
  const [error, setError] = useState('');

  const selectedFileParam = searchParams.get('file');

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

  if (isLoading || (!analysis && !error)) {
    return <div className="p-4 text-sm text-slate-500">Loading analysis...</div>;
  }

  if (error) {
    return <div className="p-4 text-sm text-red-400">{error}</div>;
  }

  if (!analysis) return null;

  const { overview } = analysis;

  // View: File Detail
  if (selectedFile) {
    const depCount = selectedFile.dependencyCount + selectedFile.dependentCount;
    // Compute dependents (files that have this file in their dependencies)
    const dependentFiles = analysis.dependencies
      .filter(d => d.dependencies.includes(selectedFile.path))
      .map(d => analysis.files.find(f => f.path === d.source))
      .filter((f): f is FileResult => Boolean(f))
      .sort((a, b) => b.metrics.frictionScore - a.metrics.frictionScore)
      .slice(0, 5); // top 5

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
      <main className="min-h-screen bg-[#0c0c0e] px-6 py-10 text-slate-200">
        <div className="mx-auto max-w-5xl">
          <header className="mb-12">
            {/* 1. Back to repository */}
            <Link href={`/analysis/${params.analysisId}`} className="text-sm text-slate-400 hover:text-slate-200 inline-flex items-center mb-8 transition-colors">
              ← {repoName || 'Back to Analysis'}
            </Link>
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-8 border-b border-slate-800 pb-8">
              <div>
                {/* 2. File name + repository name */}
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">{repoName || 'Repository'}</h2>
                <h1 className="text-2xl font-bold text-slate-100 break-all">{selectedFile.path}</h1>
              </div>
              <div className="text-left md:text-right shrink-0">
                {/* 3. Large friction score and risk level */}
                <div className={`text-sm font-semibold uppercase tracking-widest mb-1 ${scoreTextColor(selectedFile.metrics.frictionScore)}`}>
                  {classifyRisk(selectedFile.metrics.frictionScore)} RISK
                </div>
                <div className={`text-4xl font-bold ${scoreTextColor(selectedFile.metrics.frictionScore)}`}>
                  {Math.round(selectedFile.metrics.frictionScore)}<span className="text-xl text-slate-600">/100</span>
                </div>
              </div>
            </div>
          </header>

          {/* DECISION AREA */}
          <div className="grid gap-12 md:grid-cols-2 mb-16">
            <div>
              <section className="mb-12">
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Why this matters</h2>
                <p className="text-base text-slate-300 leading-relaxed mb-4">
                  {matterReason}
                </p>
                <p className="text-sm text-slate-500 italic">
                  {evidenceSentence}
                </p>
              </section>

              <section>
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Before you change this file</h2>
                <ul className="space-y-3 text-sm text-slate-300 border-l-2 border-slate-800 pl-4">
                  {selectedFile.dependentCount > 0 && <li className="flex items-start gap-2"><span className="text-slate-500">✓</span> Review {selectedFile.dependentCount} dependent modules before deploying</li>}
                  {selectedFile.changeCount > 0 && <li className="flex items-start gap-2"><span className="text-slate-500">✓</span> Check recent Git history for context on frequent changes</li>}
                  {selectedFile.coChangedWith.length > 0 && <li className="flex items-start gap-2"><span className="text-slate-500">✓</span> Coordinate with owners of {selectedFile.coChangedWith.length} frequently co-changed files</li>}
                  <li className="flex items-start gap-2"><span className="text-slate-500">✓</span> Run all relevant unit and integration tests</li>
                </ul>
              </section>
            </div>

            <div>
              <section className="mb-12">
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">What could be affected?</h2>
                {dependentFiles.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-sm text-slate-400 mb-3">Showing {dependentFiles.length} of {selectedFile.dependentCount} affected modules</p>
                    <ul className="space-y-2">
                      {dependentFiles.map(f => (
                        <li key={f.path} className="flex justify-between items-center border border-slate-800 rounded p-3 bg-[#121214]">
                          <span className="text-sm font-medium text-slate-300 truncate mr-4" title={f.path}>{f.path}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded border uppercase shrink-0 ${scoreColor(f.metrics.frictionScore)}`}>
                            {classifyRisk(f.metrics.frictionScore)} · {Math.round(f.metrics.frictionScore)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {selectedFile.dependentCount > 5 && (
                      <p className="text-xs text-slate-500 mt-4 hover:text-slate-300 cursor-pointer transition-colors inline-block">
                        View all affected modules →
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 italic border border-slate-800 rounded p-4">No direct dependents found.</p>
                )}
              </section>
            </div>
          </div>

          {/* EVIDENCE AREA */}
          <div className="grid gap-12 md:grid-cols-2 mb-16 pt-12 border-t border-slate-800">
            <section>
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Why is this {classifyRisk(selectedFile.metrics.frictionScore).toLowerCase()} risk?</h2>
              <ul className="space-y-4 text-sm text-slate-300 border border-slate-800 rounded p-5 bg-[#121214]">
                <li className="flex justify-between items-start gap-4">
                  <span>How many other parts of the codebase rely on this file</span>
                  <span className={`font-semibold shrink-0 ${scoreTextColor(selectedFile.metrics.dependencyImpact)}`}>{getSignalLevel(selectedFile.metrics.dependencyImpact)}</span>
                </li>
                <li className="flex justify-between items-start gap-4 border-t border-slate-800/50 pt-3">
                  <span>How often this file is modified</span>
                  <span className={`font-semibold shrink-0 ${scoreTextColor(selectedFile.metrics.changeFrequency)}`}>{getSignalLevel(selectedFile.metrics.changeFrequency)}</span>
                </li>
                <li className="flex justify-between items-start gap-4 border-t border-slate-800/50 pt-3">
                  <span>How frequently this file requires changes in other files</span>
                  <span className={`font-semibold shrink-0 ${scoreTextColor(selectedFile.metrics.coChangeCoupling)}`}>{getSignalLevel(selectedFile.metrics.coChangeCoupling)}</span>
                </li>
                <li className="flex justify-between items-start gap-4 border-t border-slate-800/50 pt-3">
                  <span>How many different developers modify this file</span>
                  <span className={`font-semibold shrink-0 ${scoreTextColor(selectedFile.metrics.contributorComplexity)}`}>{getSignalLevel(selectedFile.metrics.contributorComplexity)}</span>
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Technical Evidence</h2>
              <div className="border border-slate-800 rounded bg-[#121214] p-5 text-xs font-mono text-slate-400 space-y-3">
                <p className="flex justify-between"><span>Friction Score:</span> <span>{selectedFile.metrics.frictionScore.toFixed(4)}</span></p>
                <p className="flex justify-between"><span>Dependency Impact:</span> <span>{selectedFile.metrics.dependencyImpact.toFixed(4)}</span></p>
                <p className="flex justify-between"><span>Change Frequency:</span> <span>{selectedFile.metrics.changeFrequency.toFixed(4)}</span></p>
                <p className="flex justify-between"><span>Historical Coupling:</span> <span>{selectedFile.metrics.coChangeCoupling.toFixed(4)}</span></p>
                <p className="flex justify-between"><span>Contributor Spread:</span> <span>{selectedFile.metrics.contributorComplexity.toFixed(4)}</span></p>
                <p className="flex justify-between"><span>Historical Risk:</span> <span>{selectedFile.metrics.historicalRisk.toFixed(4)}</span></p>
              </div>
            </section>
          </div>

          {/* EXPLORE AREA */}
          <section className="space-y-12 pt-12 border-t border-slate-800">
            <div>
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">Dependency impact</h2>
              <p className="text-sm text-slate-400 mb-6">Shows which parts of the codebase depend on this file.</p>
              <div className="h-[420px] border border-slate-800 rounded bg-[#121214] relative overflow-hidden">
                <DependencyGraph 
                  files={analysis.files} 
                  dependencies={analysis.dependencies} 
                  selectedFilePath={selectedFile.path} 
                  onSelectFile={handleSelectFile} 
                />
              </div>
            </div>

            <div>
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">Historical coupling</h2>
              <p className="text-sm text-slate-400 mb-6">Shows files that frequently change together with this file.</p>
              <div className="h-[420px] border border-slate-800 rounded bg-[#121214] relative overflow-hidden">
                <CoChangeGraph 
                  files={analysis.files} 
                  cochanges={analysis.cochanges} 
                  selectedFilePath={selectedFile.path} 
                  onSelectFile={handleSelectFile} 
                />
              </div>
            </div>
          </section>
        </div>
      </main>
    );
  }

  // View: Overview
  return (
    <main className="min-h-screen bg-[#0c0c0e] px-6 py-10 text-slate-200">
      <div className="mx-auto max-w-4xl">
        <header className="mb-12 border-b border-slate-800 pb-8">
          <Link href="/dashboard" className="text-sm text-slate-400 hover:text-slate-200 inline-flex items-center mb-6 transition-colors">
            ← Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-slate-100 mb-6">{repoName || 'Repository Overview'}</h1>
          
          <div className="mb-6">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">Overall change friction</p>
            <div className="flex items-baseline gap-3">
              <span className={`text-4xl font-bold ${scoreTextColor(overview.overallScore)}`}>{Math.round(overview.overallScore)}</span>
              <span className="text-xl text-slate-600">/ 100</span>
              <span className={`ml-2 text-sm font-semibold uppercase tracking-widest ${scoreTextColor(overview.overallScore)}`}>{classifyRisk(overview.overallScore)}</span>
            </div>
          </div>

          <p className="text-base text-slate-300 max-w-2xl leading-relaxed">
            Most of the repository is relatively stable, but <strong className="text-slate-100">{overview.highFrictionFiles} files</strong> have high change friction and <strong className="text-slate-100">{overview.mediumFrictionFiles} files</strong> have moderate friction. These files should be reviewed carefully before making changes.
          </p>
        </header>

        <section>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Files needing attention</h2>
          
          <div className="space-y-3">
            {sortedFiles.length === 0 ? (
              <p className="text-sm text-slate-500 italic p-4 border border-slate-800 rounded">No files analyzed or found.</p>
            ) : null}
            
            {sortedFiles.slice(0, 50).map((file) => {
              // Summarize explanation: take first sentence or first 120 chars
              let reason = file.explanation.split('.')[0];
              if (reason) reason += '.';
              
              return (
                <div key={file.path} className="flex flex-col sm:flex-row sm:items-center justify-between border border-slate-800 bg-[#121214] p-4 rounded hover:border-slate-600 transition-colors">
                  <div className="mb-3 sm:mb-0 mr-4">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="text-sm font-medium text-slate-200 truncate max-w-md" title={file.path}>{file.path}</h3>
                      <span className={`text-[10px] px-2 py-0.5 rounded border uppercase shrink-0 ${scoreColor(file.metrics.frictionScore)}`}>
                        {classifyRisk(file.metrics.frictionScore)} · {Math.round(file.metrics.frictionScore)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 line-clamp-1" title={file.explanation}>
                      {reason}
                    </p>
                  </div>
                  <button 
                    onClick={() => handleSelectFile(file.path)}
                    className="shrink-0 rounded border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors whitespace-nowrap self-start sm:self-auto"
                  >
                    View details
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
