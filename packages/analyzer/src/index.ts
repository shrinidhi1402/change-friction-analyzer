import path from 'node:path';
import { existsSync } from 'node:fs';
import { detectSourceFiles, buildDependencyGraph } from './parser.js';
import { getGitHistory, getRepositoryMetadata, identifyRiskSignals, getCoChangePairs, getFileHistory } from './git.js';
import { calculateFileMetrics, summarizeAnalysis } from './score.js';

export type AnalyzerOptions = {
  repositoryPath: string;
  analysisPath?: string;
};

export const analyzeRepository = ({ repositoryPath, analysisPath }: AnalyzerOptions) => {
  if (!existsSync(repositoryPath)) {
    throw new Error(`Repository path does not exist: ${repositoryPath}`);
  }

  const analysisTarget = analysisPath ? path.resolve(analysisPath) : repositoryPath;
  if (!existsSync(analysisTarget)) {
    throw new Error(`Analysis path does not exist: ${analysisTarget}`);
  }

  const sourceFiles = detectSourceFiles(analysisTarget);
  const history = getGitHistory(repositoryPath);
  const repoMetadata = getRepositoryMetadata(repositoryPath);
  const dependencyGraph = buildDependencyGraph(repositoryPath, sourceFiles);

  const relativeFiles = sourceFiles.map((filePath) => path.relative(repositoryPath, filePath).replace(/\\/g, '/'));
  const dependentsByFile = new Map<string, string[]>();
  const relativeDependenciesByFile = new Map<string, string[]>();

  for (const file of relativeFiles) {
    dependentsByFile.set(file, []);
    relativeDependenciesByFile.set(file, []);
  }

  for (const [file, dependencies] of dependencyGraph.entries()) {
    const relative = path.relative(repositoryPath, file).replace(/\\/g, '/');
    const relativeDependencies: string[] = [];
    
    for (const dependency of dependencies) {
      const parent = relativeFiles.find((candidate) => candidate === dependency || candidate.endsWith(`/${dependency.split('/').at(-1) ?? ''}`));
      if (parent) {
        relativeDependencies.push(parent);
        const list = dependentsByFile.get(parent) ?? [];
        list.push(relative);
        dependentsByFile.set(parent, [...new Set(list)]);
      }
    }
    
    relativeDependenciesByFile.set(relative, [...new Set(relativeDependencies)]);
  }

  const coChangePairs = getCoChangePairs(history, relativeFiles); 
  const coChangeMap = new Map<string, string[]>();
  for (const pair of coChangePairs) {
    const sourceList = coChangeMap.get(pair.source) ?? [];
    const targetList = coChangeMap.get(pair.target) ?? [];
    sourceList.push(pair.target);
    targetList.push(pair.source);
    coChangeMap.set(pair.source, [...new Set(sourceList)]);
    coChangeMap.set(pair.target, [...new Set(targetList)]);
  }

  const rawStats = relativeFiles.map((relativePath) => {
    const fileHistory = getFileHistory(history, relativePath);
    const changeCount = fileHistory.length;
    const contributors = new Set(fileHistory.map((entry) => entry.author));
    const dependencies = relativeDependenciesByFile.get(relativePath) ?? [];
    const dependents = dependentsByFile.get(relativePath) ?? [];
    const coChangedWith = coChangeMap.get(relativePath) ?? [];
    
    // Calculate coupling weight (sum of counts for valid pairs)
    const fileCoChangePairs = coChangePairs.filter(p => p.source === relativePath || p.target === relativePath);
    const couplingWeight = fileCoChangePairs.reduce((sum, p) => sum + (p.count >= 2 ? p.count : 0), 0);
    
    const riskSignals = identifyRiskSignals(history, relativePath);

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
      history,
      maxMetrics,
    });
  });

  const summary = summarizeAnalysis(files);

  return {
    repository: {
      name: repoMetadata.repoName,
      commitCount: repoMetadata.commitCount,
      fileCount: repoMetadata.fileCount,
    },
    repositoryPath,
    generatedAt: new Date().toISOString(),
    files,
    overallScore: summary.overallScore,
    summary,
    dependencies: [...relativeDependenciesByFile.entries()].map(([file, deps]) => ({
      source: file,
      dependencies: deps,
    })),
    coChanges: coChangePairs,
  };
};

export { detectSourceFiles, buildDependencyGraph };
