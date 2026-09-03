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
}));

vi.mock('./git.js', () => ({
  getGitHistory: vi.fn(),
  getRepositoryMetadata: vi.fn(),
  identifyRiskSignals: vi.fn(() => []),
  getCoChangePairs: vi.fn(() => []),
  getFileHistory: vi.fn(() => [{ author: 'alice' }]),
}));

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

    // This ensures that the graph frontend component can match the dependency exactly
    // to the file object and resolve its friction score correctly.
  });
});
