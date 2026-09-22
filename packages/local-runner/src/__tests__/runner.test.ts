import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as childProcess from 'node:child_process';
import fs from 'node:fs';
import * as analyzerModule from '@change-friction/analyzer';
import { analyzeLocalRepository } from '../runner.js';

vi.mock('node:child_process', () => {
  return {
    execFile: vi.fn((cmd, args, options, callback) => {
      const cb = typeof callback === 'function' ? callback : typeof options === 'function' ? options : null;
      if (cb) cb(null, '', '');
    }),
  };
});

vi.mock('@change-friction/analyzer', () => {
  return {
    analyzeRepository: vi.fn().mockReturnValue({
      repository: { name: 'mock-repo', commitCount: 10, fileCount: 5 },
      repositoryPath: '/mock/path',
      generatedAt: '2026-09-20T00:00:00.000Z',
      files: [],
    }),
  };
});

describe('analyzeLocalRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects non-github URLs', async () => {
    await expect(
      analyzeLocalRepository({ repoUrl: 'https://example.com/repo' })
    ).rejects.toThrow('Only github.com URLs are supported.');
  });

  it('rejects URLs with command injection attempts', async () => {
    await expect(
      analyzeLocalRepository({ repoUrl: 'https://github.com/foo/bar;rm -rf /' })
    ).rejects.toThrow('Only github.com URLs are supported.');
  });

  it('clones locally with core.longpaths=true, --depth 500, and --filter=blob:none by default', async () => {
    const rmSpy = vi.spyOn(fs, 'rmSync');
    const result = await analyzeLocalRepository({ repoUrl: 'https://github.com/expressjs/express' });

    expect(childProcess.execFile).toHaveBeenCalledTimes(1);
    const [cmd, args, options] = vi.mocked(childProcess.execFile).mock.calls[0];
    expect(cmd).toBe('git');
    expect(args).toEqual([
      '-c',
      'core.longpaths=true',
      'clone',
      '--depth',
      '500',
      '--filter=blob:none',
      'https://github.com/expressjs/express',
      expect.stringMatching(/cfa-/),
    ]);
    expect(options).toEqual({ timeout: 300000, maxBuffer: 10 * 1024 * 1024 });

    expect(analyzerModule.analyzeRepository).toHaveBeenCalledWith({
      repositoryPath: expect.stringMatching(/cfa-/),
    });
    expect(result).toEqual({
      repository: { name: 'mock-repo', commitCount: 10, fileCount: 5 },
      repositoryPath: '/mock/path',
      generatedAt: '2026-09-20T00:00:00.000Z',
      files: [],
    });
    expect(rmSpy).toHaveBeenCalledWith(
      expect.stringMatching(/cfa-/),
      { recursive: true, force: true }
    );
  });

  it('supports custom clone depth', async () => {
    await analyzeLocalRepository({
      repoUrl: 'https://github.com/expressjs/express',
      depth: '250',
    });

    expect(childProcess.execFile).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['--depth', '250']),
      expect.anything(),
      expect.anything()
    );
  });

  it('forwards analysisPath to analyzeRepository when provided', async () => {
    await analyzeLocalRepository({
      repoUrl: 'https://github.com/expressjs/express',
      analysisPath: 'src/lib',
    });

    expect(analyzerModule.analyzeRepository).toHaveBeenCalledWith({
      repositoryPath: expect.stringMatching(/cfa-/),
      analysisPath: 'src/lib',
    });
  });

  it('cleans up temporary clone directory when git clone fails', async () => {
    vi.mocked(childProcess.execFile).mockImplementationOnce((cmd, args, options, callback) => {
      const cb = typeof callback === 'function' ? callback : typeof options === 'function' ? options : null;
      if (cb) cb(new Error('Git network failure'), '', '');
      return {} as any;
    });

    const rmSpy = vi.spyOn(fs, 'rmSync');

    await expect(
      analyzeLocalRepository({ repoUrl: 'https://github.com/expressjs/express' })
    ).rejects.toThrow('Git network failure');

    expect(rmSpy).toHaveBeenCalledWith(
      expect.stringMatching(/cfa-/),
      { recursive: true, force: true }
    );
  });

  it('cleans up temporary clone directory when analyzeRepository throws', async () => {
    vi.mocked(analyzerModule.analyzeRepository).mockImplementationOnce(() => {
      throw new Error('Analysis parse error');
    });

    const rmSpy = vi.spyOn(fs, 'rmSync');

    await expect(
      analyzeLocalRepository({ repoUrl: 'https://github.com/expressjs/express' })
    ).rejects.toThrow('Analysis parse error');

    expect(rmSpy).toHaveBeenCalledWith(
      expect.stringMatching(/cfa-/),
      { recursive: true, force: true }
    );
  });
});
