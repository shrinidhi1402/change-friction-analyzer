import { execFileSync } from 'node:child_process';
import path from 'node:path';

export type GitCommitInfo = {
  hash: string;
  author: string;
  message: string;
  file: string;
};

export const DEFAULT_MAX_FILES_PER_COMMIT = 100;
export const DEFAULT_TOP_K_CO_CHANGE = 15;
export const DEFAULT_MAX_GRAPH_PAIRS = 5000;

export type CoChangeOptions = {
  maxFilesPerCommit?: number;
  topKPerFile?: number;
  maxGraphPairs?: number;
};

export type CoChangeAnalysisResult = {
  couplingWeights: Map<string, number>;
  coChangedWithMap: Map<string, string[]>;
  boundedPairs: Array<{ source: string; target: string; count: number }>;
};

const isIgnorablePath = (filePath: string): boolean => {
  const normalized = filePath.replace(/\\/g, '/');
  return /(^|\/)(node_modules|\.git|dist|build|coverage|\.next|\.turbo|vendor)(\/|$)/.test(normalized)
    || /\.(lock|png|jpg|jpeg|gif|svg|ico|pdf|zip|gz|woff|woff2|ttf|png|webp)$/.test(normalized)
    || normalized.endsWith('.snap');
};

export const getRepositoryMetadata = (repoPath: string): { commitCount: number; fileCount: number; repoName: string } => {
  const commitCount = getCommitCount(repoPath);
  const trackedFiles = getChangedFiles(repoPath).filter((file) => !isIgnorablePath(file));
  return {
    commitCount,
    fileCount: trackedFiles.length,
    repoName: path.basename(repoPath),
  };
};

export const getCommitCount = (repoPath: string): number => {
  try {
    const output = execFileSync('git', ['-C', repoPath, 'rev-list', '--count', 'HEAD'], { encoding: 'utf-8' });
    return Number.parseInt(output.trim(), 10) || 0;
  } catch {
    return 0;
  }
};

export const getGitHistory = (repoPath: string): GitCommitInfo[] => {
  try {
    const output = execFileSync(
      'git',
      ['-C', repoPath, 'log', '--pretty=format:%H%x1f%an%x1f%s', '--name-only', '--no-renames'],
      { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
    );

    const lines = output.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const commits: GitCommitInfo[] = [];
    let current: { hash: string; author: string; message: string } | null = null;

    for (const line of lines) {
      if (line.includes('\x1f')) {
        const [hash, author, ...messageParts] = line.split('\x1f');
        current = { hash, author, message: messageParts.join('\x1f').trim() };
        continue;
      }

      if (!current) continue;
      const file = line.trim();
      if (!file || isIgnorablePath(file)) continue;
      commits.push({ hash: current.hash, author: current.author, message: current.message, file: file.replace(/\\/g, '/') });
    }

    return commits;
  } catch (error) {
    console.error('Git history extraction failed:', error);
    return [];
  }
};

export const getChangedFiles = (repoPath: string): string[] => {
  try {
    const output = execFileSync('git', ['-C', repoPath, 'ls-files'], { encoding: 'utf-8' });
    return output.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).map((file) => file.replace(/\\/g, '/'));
  } catch {
    return [];
  }
};

export const getContributorMap = (repoPath: string): Map<string, number> => {
  const history = getGitHistory(repoPath);
  const result = new Map<string, number>();

  for (const commit of history) {
    const count = result.get(commit.author) ?? 0;
    result.set(commit.author, count + 1);
  }

  return result;
};

/**
 * Pre-indexes Git history by normalized relative file path for O(1) file lookups.
 * Prevents O(N * |history|) performance degradation on large repositories.
 */
export const buildHistoryIndex = (history: GitCommitInfo[]): Map<string, GitCommitInfo[]> => {
  const index = new Map<string, GitCommitInfo[]>();
  for (const entry of history) {
    const normalized = entry.file.replace(/\\/g, '/');
    let list = index.get(normalized);
    if (!list) {
      list = [];
      index.set(normalized, list);
    }
    list.push(entry);
  }
  return index;
};

export const getFileHistory = (
  history: GitCommitInfo[] | Map<string, GitCommitInfo[]>,
  filePath: string
): GitCommitInfo[] => {
  const normalizedFile = filePath.replace(/\\/g, '/');
  if (history instanceof Map) {
    return history.get(normalizedFile) ?? [];
  }
  return history.filter((entry) => entry.file === normalizedFile);
};

export const identifyRiskSignals = (
  history: GitCommitInfo[] | Map<string, GitCommitInfo[]>,
  filePath: string
): string[] => {
  const fileHistory = getFileHistory(history, filePath);
  const signals: string[] = [];

  for (const commit of fileHistory) {
    const message = commit.message.toLowerCase();
    if (/(fix|bug|bugfix|hotfix|revert|rollback|regression)/.test(message)) {
      signals.push(`${commit.author}: ${commit.message}`);
    }
  }

  return signals;
};

/**
 * Analyzes co-change coupling from Git history with bounded memory usage:
 * 
 * 1. Commits <= maxFilesPerCommit (default 100):
 *    - Accumulated pairwise into pairCounts.
 *    - couplingWeight is the exact sum of counts for valid pairs meeting count >= 2.
 * 
 * 2. Commits > maxFilesPerCommit:
 *    - Excluded from co-change pair generation entirely (bulk/administrative commits).
 *    - Avoids arbitrary lexical coupling and prevents O(M^2) memory exhaustion.
 *    - Still fully contribute to Git history metrics (changeCount, contributorCount, risk).
 * 
 * 3. coChangedWith:
 *    - Bounded to top-K relationships ordered deterministically: count desc, path asc.
 * 
 * 4. boundedPairs:
 *    - Presentation/graph subset only; does not alter scoring.
 */
export const calculateCoChangeAnalysis = (
  history: GitCommitInfo[],
  sourceFiles: string[] = [],
  options?: CoChangeOptions
): CoChangeAnalysisResult => {
  const maxFiles = options?.maxFilesPerCommit ?? DEFAULT_MAX_FILES_PER_COMMIT;
  const topK = options?.topKPerFile ?? DEFAULT_TOP_K_CO_CHANGE;
  const maxPairs = options?.maxGraphPairs ?? DEFAULT_MAX_GRAPH_PAIRS;

  const fileSet = new Set(sourceFiles.map((f) => f.replace(/\\/g, '/')));
  const commitGroups = new Map<string, Set<string>>();

  for (const commit of history) {
    const normalized = commit.file.replace(/\\/g, '/');
    if (fileSet.has(normalized)) {
      let group = commitGroups.get(commit.hash);
      if (!group) {
        group = new Set<string>();
        commitGroups.set(commit.hash, group);
      }
      group.add(normalized);
    }
  }

  // Initialize couplingWeights to 0 for all source files
  const couplingWeights = new Map<string, number>();
  for (const f of sourceFiles) {
    couplingWeights.set(f.replace(/\\/g, '/'), 0);
  }

  const pairCounts = new Map<string, number>();

  for (const currentFiles of commitGroups.values()) {
    // Ignore commits with fewer than 2 relevant files
    if (currentFiles.size < 2) continue;

    // BULK/ADMINISTRATIVE COMMIT SAFEGUARD:
    // If relevant source files in a commit > maxFilesPerCommit, exclude this commit
    // from co-change pair generation entirely.
    if (currentFiles.size > maxFiles) {
      continue;
    }

    const files = [...currentFiles].sort();
    for (let i = 0; i < files.length; i += 1) {
      const source = files[i];
      for (let j = i + 1; j < files.length; j += 1) {
        const target = files[j];
        const key = `${source}::${target}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }

  // 1. EXACT PER-FILE CO-CHANGE WEIGHT:
  // For every valid co-change pair meeting the threshold (count >= 2),
  // increment couplingWeight for BOTH files.
  for (const [key, count] of pairCounts.entries()) {
    if (count >= 2) {
      const sep = key.indexOf('::');
      const source = key.slice(0, sep);
      const target = key.slice(sep + 2);

      couplingWeights.set(source, (couplingWeights.get(source) ?? 0) + count);
      couplingWeights.set(target, (couplingWeights.get(target) ?? 0) + count);
    }
  }

  // 2. BOUNDED PRESENTATION GRAPH (coChangedWithMap & boundedPairs):
  const partnersByFile = new Map<string, Array<{ partner: string; count: number }>>();
  for (const f of sourceFiles) {
    partnersByFile.set(f.replace(/\\/g, '/'), []);
  }

  for (const [key, count] of pairCounts.entries()) {
    const sep = key.indexOf('::');
    const source = key.slice(0, sep);
    const target = key.slice(sep + 2);

    partnersByFile.get(source)?.push({ partner: target, count });
    partnersByFile.get(target)?.push({ partner: source, count });
  }

  const coChangedWithMap = new Map<string, string[]>();
  for (const [file, partners] of partnersByFile.entries()) {
    // Deterministic ordering: count descending, then path ascending
    partners.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.partner.localeCompare(b.partner);
    });

    const topPartners = partners.slice(0, topK).map((p) => p.partner);
    coChangedWithMap.set(file, topPartners);
  }

  // Bounded graph edges for presentation
  const allPairs: Array<{ source: string; target: string; count: number }> = [];
  for (const [key, count] of pairCounts.entries()) {
    const sep = key.indexOf('::');
    const source = key.slice(0, sep);
    const target = key.slice(sep + 2);
    allPairs.push({ source, target, count });
  }

  allPairs.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const keyA = `${a.source}::${a.target}`;
    const keyB = `${b.source}::${b.target}`;
    return keyA.localeCompare(keyB);
  });

  const boundedPairs = allPairs.slice(0, maxPairs);

  return {
    couplingWeights,
    coChangedWithMap,
    boundedPairs,
  };
};

export const getCoChangePairs = (
  history: GitCommitInfo[],
  sourceFiles: string[] = [],
  options?: CoChangeOptions
): Array<{ source: string; target: string; count: number }> => {
  const analysis = calculateCoChangeAnalysis(history, sourceFiles, options);
  return analysis.boundedPairs;
};
