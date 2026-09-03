import { execFileSync } from 'node:child_process';
import path from 'node:path';

export type GitCommitInfo = {
  hash: string;
  author: string;
  message: string;
  file: string;
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

export const getFileHistory = (history: GitCommitInfo[], filePath: string): GitCommitInfo[] => {
  const normalizedFile = filePath.replace(/\\/g, '/');
  return history.filter((entry) => entry.file === normalizedFile);
};

export const identifyRiskSignals = (history: GitCommitInfo[], filePath: string): string[] => {
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

export const getCoChangePairs = (history: GitCommitInfo[], sourceFiles: string[] = []): Array<{ source: string; target: string; count: number }> => {
  const fileSet = new Set(sourceFiles.map((file) => file.replace(/\\/g, '/')));
  const pairCounts = new Map<string, number>();
  const commitGroups = new Map<string, Set<string>>();

  for (const commit of history) {
    if (fileSet.has(commit.file)) {
      let group = commitGroups.get(commit.hash);
      if (!group) {
        group = new Set<string>();
        commitGroups.set(commit.hash, group);
      }
      group.add(commit.file);
    }
  }

  for (const currentFiles of commitGroups.values()) {
    const files = [...currentFiles].sort();
    for (let i = 0; i < files.length; i += 1) {
      for (let j = i + 1; j < files.length; j += 1) {
        const source = files[i];
        const target = files[j];
        const key = [source, target].sort().join('::');
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }

  return [...pairCounts.entries()].map(([key, count]) => {
    const [source, target] = key.split('::');
    return { source, target, count };
  }).filter((entry) => entry.source && entry.target && entry.count > 0);
};
