import { describe, expect, it } from 'vitest';
import {
  getFileHistory,
  getCoChangePairs,
  getGitHistory,
  calculateCoChangeAnalysis,
  buildHistoryIndex,
  type GitCommitInfo,
} from './git.js';
import * as childProcess from 'node:child_process';
import { vi } from 'vitest';

describe('git analyzer', () => {
  describe('getFileHistory and buildHistoryIndex', () => {
    it('matches exact paths and ignores similar suffixes', () => {
      const history: GitCommitInfo[] = [
        { hash: '1', author: 'Alice', message: 'init', file: 'src/auth.ts' },
        { hash: '2', author: 'Bob', message: 'fix', file: 'lib/src/auth.ts' },
        { hash: '3', author: 'Charlie', message: 'update', file: 'auth.ts' },
      ];

      const srcAuth = getFileHistory(history, 'src/auth.ts');
      expect(srcAuth).toHaveLength(1);
      expect(srcAuth[0].hash).toBe('1');

      const libSrcAuth = getFileHistory(history, 'lib/src/auth.ts');
      expect(libSrcAuth).toHaveLength(1);
      expect(libSrcAuth[0].hash).toBe('2');

      const rootAuth = getFileHistory(history, 'auth.ts');
      expect(rootAuth).toHaveLength(1);
      expect(rootAuth[0].hash).toBe('3');
    });

    it('buildHistoryIndex provides O(1) file history lookups matching getFileHistory', () => {
      const history: GitCommitInfo[] = [
        { hash: '1', author: 'Alice', message: 'init', file: 'src/a.ts' },
        { hash: '2', author: 'Bob', message: 'fix', file: 'src/a.ts' },
        { hash: '3', author: 'Charlie', message: 'update', file: 'src/b.ts' },
      ];

      const index = buildHistoryIndex(history);
      expect(getFileHistory(index, 'src/a.ts')).toHaveLength(2);
      expect(getFileHistory(index, 'src/b.ts')).toHaveLength(1);
      expect(getFileHistory(index, 'src/c.ts')).toHaveLength(0);
    });
  });

  describe('getCoChangePairs', () => {
    it('calculates correct co-change frequencies in O(N)', () => {
      const history: GitCommitInfo[] = [
        { hash: 'A', author: 'Alice', message: 'init', file: 'a.ts' },
        { hash: 'A', author: 'Alice', message: 'init', file: 'b.ts' },
        { hash: 'A', author: 'Alice', message: 'init', file: 'c.ts' },
        { hash: 'B', author: 'Bob', message: 'update', file: 'a.ts' },
        { hash: 'B', author: 'Bob', message: 'update', file: 'b.ts' },
        { hash: 'C', author: 'Charlie', message: 'fix', file: 'b.ts' },
        { hash: 'C', author: 'Charlie', message: 'fix', file: 'c.ts' },
      ];

      const sourceFiles = ['a.ts', 'b.ts', 'c.ts'];
      const pairs = getCoChangePairs(history, sourceFiles);

      // A+B changed together in commits A and B -> count 2
      const ab = pairs.find((p) => p.source === 'a.ts' && p.target === 'b.ts');
      expect(ab).toBeDefined();
      expect(ab?.count).toBe(2);

      // A+C changed together in commit A -> count 1
      const ac = pairs.find((p) => p.source === 'a.ts' && p.target === 'c.ts');
      expect(ac).toBeDefined();
      expect(ac?.count).toBe(1);

      // B+C changed together in commits A and C -> count 2
      const bc = pairs.find((p) => p.source === 'b.ts' && p.target === 'c.ts');
      expect(bc).toBeDefined();
      expect(bc?.count).toBe(2);
    });
  });

  describe('calculateCoChangeAnalysis and scalability rules', () => {
    it('aggregates coupling weights for pairs meeting the >=2 threshold and accumulates repeated commits', () => {
      const history: GitCommitInfo[] = [
        // Commit 1: A, B, C
        { hash: '1', author: 'Alice', message: 'c1', file: 'a.ts' },
        { hash: '1', author: 'Alice', message: 'c1', file: 'b.ts' },
        { hash: '1', author: 'Alice', message: 'c1', file: 'c.ts' },
        // Commit 2: A, B
        { hash: '2', author: 'Bob', message: 'c2', file: 'a.ts' },
        { hash: '2', author: 'Bob', message: 'c2', file: 'b.ts' },
        // Commit 3: A, B (repeated commit)
        { hash: '3', author: 'Charlie', message: 'c3', file: 'a.ts' },
        { hash: '3', author: 'Charlie', message: 'c3', file: 'b.ts' },
      ];

      const sourceFiles = ['a.ts', 'b.ts', 'c.ts'];
      const analysis = calculateCoChangeAnalysis(history, sourceFiles);

      // Pair A::B appears in 3 commits (>= 2 threshold) -> count 3
      // Pair A::C appears in 1 commit (< 2 threshold) -> count 1
      // Pair B::C appears in 1 commit (< 2 threshold) -> count 1
      // For A: valid pair is A::B (3) -> couplingWeight = 3
      // For B: valid pair is A::B (3) -> couplingWeight = 3
      // For C: no pairs >= 2 -> couplingWeight = 0
      expect(analysis.couplingWeights.get('a.ts')).toBe(3);
      expect(analysis.couplingWeights.get('b.ts')).toBe(3);
      expect(analysis.couplingWeights.get('c.ts')).toBe(0);
    });

    it('bounds coChangedWith to top-K partners ordered deterministically by count desc, then path asc', () => {
      const history: GitCommitInfo[] = [];

      // A co-changes with B 4 times
      for (let i = 0; i < 4; i++) {
        history.push(
          { hash: `b_${i}`, author: 'Alice', message: 'm', file: 'src/main.ts' },
          { hash: `b_${i}`, author: 'Alice', message: 'm', file: 'src/b.ts' }
        );
      }
      // A co-changes with C 2 times
      for (let i = 0; i < 2; i++) {
        history.push(
          { hash: `c_${i}`, author: 'Bob', message: 'm', file: 'src/main.ts' },
          { hash: `c_${i}`, author: 'Bob', message: 'm', file: 'src/c.ts' }
        );
      }
      // A co-changes with A_tied 2 times (same count as C, but alphabetically before 'src/c.ts')
      for (let i = 0; i < 2; i++) {
        history.push(
          { hash: `at_${i}`, author: 'Carol', message: 'm', file: 'src/main.ts' },
          { hash: `at_${i}`, author: 'Carol', message: 'm', file: 'src/a_tied.ts' }
        );
      }
      // A co-changes with Z 1 time
      history.push(
        { hash: 'z_0', author: 'Dave', message: 'm', file: 'src/main.ts' },
        { hash: 'z_0', author: 'Dave', message: 'm', file: 'src/z.ts' }
      );

      const sourceFiles = ['src/main.ts', 'src/b.ts', 'src/c.ts', 'src/a_tied.ts', 'src/z.ts'];
      // Request top 2
      const analysis = calculateCoChangeAnalysis(history, sourceFiles, { topKPerFile: 2 });
      const partners = analysis.coChangedWithMap.get('src/main.ts');

      // Top 2 should be: 'src/b.ts' (count 4), then 'src/a_tied.ts' (count 2, ties with 'src/c.ts' but earlier alphabetically)
      expect(partners).toEqual(['src/b.ts', 'src/a_tied.ts']);
    });

    it('safeguards against bulk commits: commit with > maxFilesPerCommit contributes zero co-change pairs but still contributes Git change/contributor metrics', () => {
      const history: GitCommitInfo[] = [];

      // 1. Normal 3-file commit (hash: 'normal_1')
      history.push(
        { hash: 'normal_1', author: 'Alice', message: 'feat: normal change', file: 'src/n1.ts' },
        { hash: 'normal_1', author: 'Alice', message: 'feat: normal change', file: 'src/n2.ts' },
        { hash: 'normal_1', author: 'Alice', message: 'feat: normal change', file: 'src/n3.ts' }
      );
      // Repeated to reach >= 2 threshold for normal pairs
      history.push(
        { hash: 'normal_2', author: 'Alice', message: 'feat: normal change 2', file: 'src/n1.ts' },
        { hash: 'normal_2', author: 'Alice', message: 'feat: normal change 2', file: 'src/n2.ts' }
      );

      // 2. Huge bulk commit touching 120 files (hash: 'bulk_commit')
      const bulkFiles: string[] = [];
      for (let i = 0; i < 120; i++) {
        const file = `src/bulk/file_${i}.ts`;
        bulkFiles.push(file);
        history.push({
          hash: 'bulk_commit',
          author: 'Bot',
          message: 'chore: license headers',
          file,
        });
      }

      const allFiles = ['src/n1.ts', 'src/n2.ts', 'src/n3.ts', ...bulkFiles];
      const analysis = calculateCoChangeAnalysis(history, allFiles, { maxFilesPerCommit: 100 });

      // Normal commit contributes co-change
      expect(analysis.couplingWeights.get('src/n1.ts')).toBe(2);
      expect(analysis.couplingWeights.get('src/n2.ts')).toBe(2);

      // Huge commit (> 100 files) contributed ZERO co-change pairs:
      for (const bulkFile of bulkFiles) {
        expect(analysis.couplingWeights.get(bulkFile)).toBe(0);
        expect(analysis.coChangedWithMap.get(bulkFile)).toEqual([]);
      }

      // But the same huge commit STILL contributes to Git change & contributor history metrics!
      const historyIndex = buildHistoryIndex(history);
      const bulk0History = getFileHistory(historyIndex, 'src/bulk/file_0.ts');
      expect(bulk0History).toHaveLength(1);
      expect(bulk0History[0].hash).toBe('bulk_commit');
      expect(bulk0History[0].author).toBe('Bot');
    });
  });

  describe('getGitHistory', () => {
    it('passes maxBuffer to execFileSync and parses output correctly', async () => {
      vi.mock('node:child_process', () => ({
        execFileSync: vi.fn().mockReturnValue('abc123hash\x1fAlice\x1fInitial commit\nsrc/index.ts\n')
      }));
      const gitModule = await import('./git.js');
      const childProcessMock = await import('node:child_process');
      
      const history = gitModule.getGitHistory('.');
      
      expect(childProcessMock.execFileSync).toHaveBeenCalledWith(
        'git',
        ['-C', '.', 'log', '--pretty=format:%H%x1f%an%x1f%s', '--name-only', '--no-renames'],
        expect.objectContaining({ maxBuffer: 50 * 1024 * 1024 })
      );
      expect(history).toHaveLength(1);
      
      vi.doUnmock('node:child_process');
    });
  });
});
