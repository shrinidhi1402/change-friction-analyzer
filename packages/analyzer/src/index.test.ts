import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { analyzeRepository } from './index.js';
import * as parser from './parser.js';
import * as git from './git.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
}));

vi.mock('./parser.js', () => ({
  detectSourceFiles: vi.fn(),
  buildDependencyGraph: vi.fn(),
  getLanguageStats: vi.fn(() => ({})),
  defaultParserRegistry: {
    getLanguageBreakdown: vi.fn(() => ({ supported: {}, unsupported: {}, unknown: 0 })),
  },
}));

vi.mock('./git.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./git.js')>();
  return {
    ...actual,
    getGitHistory: vi.fn(),
    getRepositoryMetadata: vi.fn(),
    identifyRiskSignals: vi.fn(() => []),
    getCoChangePairs: vi.fn(() => []),
    getFileHistory: vi.fn(() => [{ author: 'alice' }]),
    calculateCoChangeAnalysis: vi.fn(() => ({
      couplingWeights: new Map(),
      coChangedWithMap: new Map(),
      boundedPairs: [],
    })),
  };
});

describe('analyzeRepository graph data transformation', () => {
  it('maps dependency absolute paths to relative paths matching file.path', () => {
    const repoPath = process.platform === 'win32' ? 'C:\\repos\\express' : '/repos/express';
    
    // Simulate detectSourceFiles returning absolute paths
    const sourceFiles = [
      path.join(repoPath, 'lib/response.js').replace(/\\/g, '/'),
      path.join(repoPath, 'lib/utils.js').replace(/\\/g, '/'),
    ];
    vi.mocked(parser.detectSourceFiles).mockReturnValue(sourceFiles);

    // Simulate buildDependencyGraph returning absolute paths as values
    const dependencyGraph = new Map<string, string[]>();
    dependencyGraph.set(path.join(repoPath, 'lib/response.js').replace(/\\/g, '/'), [path.join(repoPath, 'lib/utils.js').replace(/\\/g, '/')]);
    dependencyGraph.set(path.join(repoPath, 'lib/utils.js').replace(/\\/g, '/'), []);
    vi.mocked(parser.buildDependencyGraph).mockReturnValue(dependencyGraph);

    vi.mocked(git.getRepositoryMetadata).mockReturnValue({ repoName: 'express', commitCount: 1, fileCount: 2 });
    vi.mocked(git.getGitHistory).mockReturnValue([]);

    const result = analyzeRepository({ repositoryPath: repoPath });

    // Verify files array has relative paths
    const responseFile = result.files.find(f => f.path === 'lib/response.js');
    const utilsFile = result.files.find(f => f.path === 'lib/utils.js');
    expect(responseFile).toBeDefined();
    expect(utilsFile).toBeDefined();

    // Verify dependencies array uses relative paths
    const responseDeps = result.dependencies.find(d => d.source === 'lib/response.js');
    expect(responseDeps).toBeDefined();
    expect(responseDeps?.dependencies).toEqual(['lib/utils.js']);
  });

  it('correctly builds reverse dependency index in O(E): A -> B and C -> B produces dependentCount = 2 for B', () => {
    const repoPath = process.platform === 'win32' ? 'C:\\repos\\diamond' : '/repos/diamond';

    const sourceFiles = [
      path.join(repoPath, 'src/a.ts').replace(/\\/g, '/'),
      path.join(repoPath, 'src/b.ts').replace(/\\/g, '/'),
      path.join(repoPath, 'src/c.ts').replace(/\\/g, '/'),
    ];
    vi.mocked(parser.detectSourceFiles).mockReturnValue(sourceFiles);

    // Dependency graph:
    // A -> B
    // C -> B
    const dependencyGraph = new Map<string, string[]>();
    dependencyGraph.set(path.join(repoPath, 'src/a.ts').replace(/\\/g, '/'), [path.join(repoPath, 'src/b.ts').replace(/\\/g, '/')]);
    dependencyGraph.set(path.join(repoPath, 'src/b.ts').replace(/\\/g, '/'), []);
    dependencyGraph.set(path.join(repoPath, 'src/c.ts').replace(/\\/g, '/'), [path.join(repoPath, 'src/b.ts').replace(/\\/g, '/')]);
    vi.mocked(parser.buildDependencyGraph).mockReturnValue(dependencyGraph);

    vi.mocked(git.getRepositoryMetadata).mockReturnValue({ repoName: 'diamond', commitCount: 1, fileCount: 3 });
    vi.mocked(git.getGitHistory).mockReturnValue([]);

    const result = analyzeRepository({ repositoryPath: repoPath });

    const fileA = result.files.find(f => f.path === 'src/a.ts');
    const fileB = result.files.find(f => f.path === 'src/b.ts');
    const fileC = result.files.find(f => f.path === 'src/c.ts');

    expect(fileA).toBeDefined();
    expect(fileB).toBeDefined();
    expect(fileC).toBeDefined();

    // B has 2 incoming dependencies (A and C) -> dependentCount = 2
    expect(fileB?.dependentCount).toBe(2);
    expect(fileB?.dependencyCount).toBe(0);

    // A depends on B -> dependencyCount = 1, dependentCount = 0
    expect(fileA?.dependencyCount).toBe(1);
    expect(fileA?.dependentCount).toBe(0);

    // C depends on B -> dependencyCount = 1, dependentCount = 0
    expect(fileC?.dependencyCount).toBe(1);
    expect(fileC?.dependentCount).toBe(0);
  });

  it('handles empty dependencies for skipped parser failure files without inventing fake data', () => {
    const repoPath = process.platform === 'win32' ? 'C:\\repos\\test' : '/repos/test';

    const sourceFiles = [
      path.join(repoPath, 'src/good.ts').replace(/\\/g, '/'),
      path.join(repoPath, 'src/bad.ts').replace(/\\/g, '/'),
    ];
    vi.mocked(parser.detectSourceFiles).mockReturnValue(sourceFiles);

    const dependencyGraph = new Map<string, string[]>();
    dependencyGraph.set(path.join(repoPath, 'src/good.ts').replace(/\\/g, '/'), []);
    dependencyGraph.set(path.join(repoPath, 'src/bad.ts').replace(/\\/g, '/'), []); // Skipped AST parser returns []
    vi.mocked(parser.buildDependencyGraph).mockReturnValue(dependencyGraph);

    vi.mocked(git.getRepositoryMetadata).mockReturnValue({ repoName: 'test', commitCount: 2, fileCount: 2 });
    vi.mocked(git.getGitHistory).mockReturnValue([
      { hash: '1', author: 'alice', message: 'commit 1', file: 'src/bad.ts' },
      { hash: '2', author: 'bob', message: 'commit 2', file: 'src/good.ts' },
    ]);
    vi.mocked(git.getFileHistory).mockImplementation((_, file) => [
      { hash: '1', author: 'alice', message: 'test', file },
    ]);

    const result = analyzeRepository({ repositoryPath: repoPath });

    expect(result.files).toHaveLength(2);
    const badFile = result.files.find(f => f.path === 'src/bad.ts');
    expect(badFile?.dependencyCount).toBe(0);
    expect(badFile?.changeCount).toBe(1); // Git metrics still computed
    expect(badFile?.contributorCount).toBe(1);
  });
});
