import { describe, expect, it } from 'vitest';
import { getFileHistory, getCoChangePairs, getGitHistory, type GitCommitInfo } from './git.js';
import * as childProcess from 'node:child_process';
import { vi } from 'vitest';

describe('git analyzer', () => {
  describe('getFileHistory', () => {
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

  describe('getGitHistory', () => {
    it('passes maxBuffer to execFileSync and parses output correctly', async () => {
      vi.mock('node:child_process', () => ({
        execFileSync: vi.fn().mockReturnValue('abc123hash\x1fAlice\x1fInitial commit\nsrc/index.ts\n')
      }));
      // Dynamically import to ensure mock is applied
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
