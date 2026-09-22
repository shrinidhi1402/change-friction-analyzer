import path from 'node:path';
import { existsSync } from 'node:fs';
import {
  detectSourceFiles,
  buildDependencyGraph,
  getParserDiagnostics,
  clearParserDiagnostics,
  shouldParseForAst,
  detectLanguage,
  getLanguageStats,
  getFileLanguageInfo,
  defaultParserRegistry,
  type ParserDiagnostic,
} from './parser.js';
import {
  getGitHistory,
  getRepositoryMetadata,
  identifyRiskSignals,
  getCoChangePairs,
  getFileHistory,
  buildHistoryIndex,
  calculateCoChangeAnalysis,
} from './git.js';
import { calculateFileMetrics, summarizeAnalysis } from './score.js';

export type AnalyzerOptions = {
  repositoryPath: string;
  analysisPath?: string;
};

// --- TEMPORARY DIAGNOSTIC INSTRUMENTATION ---
function logMemoryStage(
  stage: string,
  startTime: number,
  lastTime: number,
  counts?: {
    sourceFiles?: number;
    dependencyEdges?: number;
    gitCommits?: number;
    coChangePairs?: number;
  }
): number {
  const now = performance.now();
  const mem = process.memoryUsage();
  const heapUsed = Math.round(mem.heapUsed / 1024 / 1024);
  const heapTotal = Math.round(mem.heapTotal / 1024 / 1024);
  const rss = Math.round(mem.rss / 1024 / 1024);
  const duration = (now - lastTime).toFixed(1);

  const parts = [
    `[Memory] ${stage}`,
    `heapUsed=${heapUsed}MB`,
    `heapTotal=${heapTotal}MB`,
    `rss=${rss}MB`,
    `duration=${duration}ms`,
  ];

  if (counts?.sourceFiles !== undefined) parts.push(`sourceFiles=${counts.sourceFiles}`);
  if (counts?.dependencyEdges !== undefined) parts.push(`dependencyEdges=${counts.dependencyEdges}`);
  if (counts?.gitCommits !== undefined) parts.push(`gitCommits=${counts.gitCommits}`);
  if (counts?.coChangePairs !== undefined) parts.push(`coChangePairs=${counts.coChangePairs}`);

  console.log(parts.join(' | '));
  return now;
}
// ---------------------------------------------

export const analyzeRepository = ({ repositoryPath, analysisPath }: AnalyzerOptions) => {
  if (!existsSync(repositoryPath)) {
    throw new Error(`Repository path does not exist: ${repositoryPath}`);
  }

  const analysisTarget = analysisPath ? path.resolve(analysisPath) : repositoryPath;
  if (!existsSync(analysisTarget)) {
    throw new Error(`Analysis path does not exist: ${analysisTarget}`);
  }

  const startTime = performance.now();
  let lastTime = startTime;

  lastTime = logMemoryStage('start', startTime, lastTime);

  const sourceFiles = detectSourceFiles(analysisTarget);
  lastTime = logMemoryStage('after source file discovery', startTime, lastTime, {
    sourceFiles: sourceFiles.length,
  });

  const dependencyGraph = buildDependencyGraph(repositoryPath, sourceFiles);
  const dependencyEdges = [...dependencyGraph.values()].reduce((sum, deps) => sum + deps.length, 0);
  lastTime = logMemoryStage('after dependency graph', startTime, lastTime, {
    sourceFiles: sourceFiles.length,
    dependencyEdges,
  });

  const history = getGitHistory(repositoryPath);
  const repoMetadata = getRepositoryMetadata(repositoryPath);
  const gitCommits = new Set(history.map((h) => h.hash)).size;
  lastTime = logMemoryStage('after git history', startTime, lastTime, {
    sourceFiles: sourceFiles.length,
    dependencyEdges,
    gitCommits,
  });

  const relativeFiles = sourceFiles.map((filePath) => path.relative(repositoryPath, filePath).replace(/\\/g, '/'));

  // Build O(1) path resolution tables to avoid O(N^2) search loops
  const fileByExactPath = new Map<string, string>();
  const fileByBasename = new Map<string, string>();
  const ambiguousBasenames = new Set<string>();

  for (const rel of relativeFiles) {
    fileByExactPath.set(rel, rel);
    const base = path.basename(rel);
    if (fileByBasename.has(base)) {
      ambiguousBasenames.add(base);
    } else {
      fileByBasename.set(base, rel);
    }
  }
  for (const amb of ambiguousBasenames) {
    fileByBasename.delete(amb);
  }

  const resolveToRelative = (rawPath: string): string | undefined => {
    const rel = path.relative(repositoryPath, path.isAbsolute(rawPath) ? rawPath : path.resolve(repositoryPath, rawPath)).replace(/\\/g, '/');
    if (fileByExactPath.has(rel)) return rel;
    const base = path.basename(rawPath);
    return fileByBasename.get(base);
  };

  const dependentsByFile = new Map<string, string[]>();
  const relativeDependenciesByFile = new Map<string, string[]>();

  for (const file of relativeFiles) {
    dependentsByFile.set(file, []);
    relativeDependenciesByFile.set(file, []);
  }

  // PART 1: O(E) Forward and Reverse Dependency Index Construction
  // For every sourceFile -> dependencyFile:
  //   record dependencyFile in sourceFile's dependencies
  //   record sourceFile in dependencyFile's dependents
  for (const [file, dependencies] of dependencyGraph.entries()) {
    const source = resolveToRelative(file);
    if (!source || !relativeDependenciesByFile.has(source)) continue;

    const sourceDeps = relativeDependenciesByFile.get(source)!;

    for (const rawDep of dependencies) {
      const target = resolveToRelative(rawDep);
      if (!target || !dependentsByFile.has(target) || source === target) continue;

      sourceDeps.push(target);
      dependentsByFile.get(target)!.push(source);
    }
  }

  for (const [file, deps] of relativeDependenciesByFile.entries()) {
    if (deps.length > 1) {
      relativeDependenciesByFile.set(file, [...new Set(deps)]);
    }
  }
  for (const [file, deps] of dependentsByFile.entries()) {
    if (deps.length > 1) {
      dependentsByFile.set(file, [...new Set(deps)]);
    }
  }

  // PART 2: Scalable Co-Change Analysis
  // - Commits <= 100 files: normal pair accumulation; pairs >= 2 add to couplingWeight.
  // - Commits > 100 files: excluded from pair generation (bulk commits).
  // - couplingWeight: exact per-file aggregate numeric counter.
  // - coChangedWith: bounded to top-K partners (ordered count desc, path asc).
  // - boundedPairs: bounded presentation graph (capped at 5000 edges).
  const coChangeAnalysis = calculateCoChangeAnalysis(history, relativeFiles);
  const { couplingWeights, coChangedWithMap, boundedPairs } = coChangeAnalysis;

  lastTime = logMemoryStage('after co-change calculation', startTime, lastTime, {
    sourceFiles: sourceFiles.length,
    dependencyEdges,
    gitCommits,
    coChangePairs: boundedPairs.length,
  });

  // Pre-index Git history by file for O(1) file history retrieval
  const historyIndex = buildHistoryIndex(history);

  const rawStats = relativeFiles.map((relativePath) => {
    const fileHistory = getFileHistory(historyIndex, relativePath);
    const changeCount = fileHistory.length;
    const contributors = new Set(fileHistory.map((entry) => entry.author));
    const dependencies = relativeDependenciesByFile.get(relativePath) ?? [];
    const dependents = dependentsByFile.get(relativePath) ?? [];
    const coChangedWith = coChangedWithMap.get(relativePath) ?? [];
    const couplingWeight = couplingWeights.get(relativePath) ?? 0;
    const riskSignals = identifyRiskSignals(fileHistory, relativePath);

    return {
      path: relativePath,
      dependencies,
      dependents,
      changeCount,
      contributorCount: contributors.size,
      coChangedWith,
      couplingWeight,
      riskSignals: riskSignals.length,
    };
  });

  const maxMetrics = {
    dependencySum: Math.max(...rawStats.map(s => s.dependencies.length + s.dependents.length), 0),
    changeCount: Math.max(...rawStats.map(s => s.changeCount), 0),
    couplingWeight: Math.max(...rawStats.map(s => s.couplingWeight), 0),
    contributorCount: Math.max(...rawStats.map(s => s.contributorCount), 0),
    riskSignals: Math.max(...rawStats.map(s => s.riskSignals), 0),
  };

  const files = rawStats.map((stats) => {
    return calculateFileMetrics({
      ...stats,
      history: historyIndex,
      maxMetrics,
    });
  });

  const summary = summarizeAnalysis(files);
  const languages = typeof getLanguageStats === 'function' ? getLanguageStats(repositoryPath, sourceFiles) : {};
  const languageBreakdown = typeof defaultParserRegistry?.getLanguageBreakdown === 'function'
    ? defaultParserRegistry.getLanguageBreakdown(repositoryPath, sourceFiles)
    : { supported: {}, unsupported: {}, unknown: 0 };

  lastTime = logMemoryStage('after scoring', startTime, lastTime, {
    sourceFiles: sourceFiles.length,
    dependencyEdges,
    gitCommits,
    coChangePairs: boundedPairs.length,
  });

  lastTime = logMemoryStage('before return', startTime, lastTime, {
    sourceFiles: sourceFiles.length,
    dependencyEdges,
    gitCommits,
    coChangePairs: boundedPairs.length,
  });

  return {
    repository: {
      name: repoMetadata.repoName,
      commitCount: repoMetadata.commitCount,
      fileCount: repoMetadata.fileCount,
    },
    repositoryPath,
    generatedAt: new Date().toISOString(),
    languages,
    languageBreakdown,
    files,
    overallScore: summary.overallScore,
    summary,
    dependencies: [...relativeDependenciesByFile.entries()].map(([file, deps]) => ({
      source: file,
      dependencies: deps,
    })),
    coChanges: boundedPairs,
  };
};

export {
  detectSourceFiles,
  buildDependencyGraph,
  getParserDiagnostics,
  clearParserDiagnostics,
  shouldParseForAst,
  detectLanguage,
  getLanguageStats,
  getFileLanguageInfo,
  defaultParserRegistry,
  type ParserDiagnostic,
};
