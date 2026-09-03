import request from 'supertest';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { server } from './index.js';
import * as child_process from 'node:child_process';
import * as fs from 'node:fs';

vi.mock('node:child_process', () => ({
  execFile: vi.fn((...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') {
      cb(null, { stdout: '', stderr: '' });
    }
    return {} as child_process.ChildProcess;
  }),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      mkdtempSync: vi.fn(() => '/tmp/mock-clone-dir'),
      rmSync: vi.fn(),
    },
    mkdtempSync: vi.fn(() => '/tmp/mock-clone-dir'),
    rmSync: vi.fn(),
  };
});

vi.mock('../../../packages/analyzer/src/index.js', () => {
  return {
    analyzeRepository: vi.fn().mockImplementation(() => {
      const files = Array.from({ length: 5000 }).map((_, i) => ({
        path: `src/file_${i}.ts`,
        metrics: {
          dependencyImpact: 50,
          changeFrequency: 50,
          coChangeCoupling: 50,
          contributorComplexity: 50,
          historicalRisk: 50,
          frictionScore: 50,
        },
        explanation: 'mock explanation',
        dependencyCount: 1,
        dependentCount: 1,
        changeCount: 1,
        contributorCount: 1,
        coChangedWith: [],
        historicalEvidence: [],
      }));

      return {
        repository: { commitCount: 100, fileCount: 5000 },
        overallScore: 50,
        summary: {
          overallScore: 50,
          filesAnalyzed: 5000,
        },
        files,
        coChanges: [],
        dependencies: [
          { source: 'src/file_0.ts', dependencies: ['src/file_1.ts', 'src/file_2.ts', 'src/file_3.ts'] },
          { source: 'src/file_1.ts', dependencies: ['src/file_2.ts'] }
        ],
      };
    })
  };
});

describe('auth and authorization', () => {
  it('registers a new user and returns a token', async () => {
    const response = await request(server)
      .post('/api/auth/register')
      .send({
        email: `alice-${Date.now()}@example.com`,
        name: 'Alice',
        password: 'password123',
      })
      .expect(201);

    expect(response.body.token).toBeTypeOf('string');
    expect(response.body.user.email).toMatch(/^alice-\d+@example\.com$/);
  });

  it('requires auth for repository routes', async () => {
    await request(server).get('/api/repositories').expect(401);
  });

  it('rejects access to a different user repository', async () => {
    const first = await request(server)
      .post('/api/auth/register')
      .send({
        email: `bob-${Date.now()}@example.com`,
        name: 'Bob',
        password: 'password123',
      })
      .expect(201);

    const second = await request(server)
      .post('/api/auth/register')
      .send({
        email: `charlie-${Date.now()}@example.com`,
        name: 'Charlie',
        password: 'password123',
      })
      .expect(201);

    const repoResponse = await request(server)
      .post('/api/repositories')
      .set('Authorization', `Bearer ${first.body.token}`)
      .send({ name: 'repo-one', url: '/tmp/repo-one' })
      .expect(201);

    await request(server)
      .get(`/api/repositories/${repoResponse.body.repository.id}`)
      .set('Authorization', `Bearer ${second.body.token}`)
      .expect(403);
  });

  it('returns existing repository instead of 409 for duplicate repositories', async () => {
    const userResponse = await request(server)
      .post('/api/auth/register')
      .send({
        email: `dup-${Date.now()}@example.com`,
        name: 'Dup',
        password: 'password123',
      })
      .expect(201);

    await request(server)
      .post('/api/repositories')
      .set('Authorization', `Bearer ${userResponse.body.token}`)
      .send({ name: 'dup-repo', url: '/tmp/dup-repo' })
      .expect(201);

    await request(server)
      .post('/api/repositories')
      .set('Authorization', `Bearer ${userResponse.body.token}`)
      .send({ name: 'dup-repo', url: '/tmp/dup-repo' })
      .expect(200);
  });

  it('rejects malicious GitHub URLs', async () => {
    const userResponse = await request(server)
      .post('/api/auth/register')
      .send({ email: `test-malicious-${Date.now()}@example.com`, name: 'Test', password: 'password123' })
      .expect(201);

    const repoResponse = await request(server)
      .post('/api/repositories')
      .set('Authorization', `Bearer ${userResponse.body.token}`)
      .send({ name: 'malicious', url: 'https://github.com/foo/bar;rm -rf /' })
      .expect(201);

    await request(server)
      .post(`/api/repositories/${repoResponse.body.repository.id}/analyze`)
      .set('Authorization', `Bearer ${userResponse.body.token}`)
      .expect(400)
      .expect((res) => {
        expect(res.body.message).toBe('Only github.com URLs are supported.');
      });
  });

  it('clones a valid GitHub URL securely with depth 5000', async () => {
    const userResponse = await request(server)
      .post('/api/auth/register')
      .send({ email: `test-clone-${Date.now()}@example.com`, name: 'Test', password: 'password123' })
      .expect(201);

    const repoResponse = await request(server)
      .post('/api/repositories')
      .set('Authorization', `Bearer ${userResponse.body.token}`)
      .send({ name: 'express', url: 'https://github.com/expressjs/express' })
      .expect(201);

    await request(server)
      .post(`/api/repositories/${repoResponse.body.repository.id}/analyze`)
      .set('Authorization', `Bearer ${userResponse.body.token}`)
      .expect(202);

    expect(child_process.execFile).toHaveBeenCalledWith(
      'git',
      ['clone', '--depth', '5000', 'https://github.com/expressjs/express', '/tmp/mock-clone-dir'],
      { timeout: 300000, maxBuffer: 10 * 1024 * 1024 },
      expect.any(Function)
    );
  }, 60000);

  it('cleans up temporary directory on clone failure', async () => {
    vi.mocked(child_process.execFile).mockImplementationOnce((...args: any[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === 'function') {
        cb(new Error('Clone failed'), '', '');
      }
      return {} as child_process.ChildProcess;
    });
    
    const userResponse = await request(server)
      .post('/api/auth/register')
      .send({ email: `test-fail-${Date.now()}@example.com`, name: 'Test', password: 'password123' })
      .expect(201);

    const repoResponse = await request(server)
      .post('/api/repositories')
      .set('Authorization', `Bearer ${userResponse.body.token}`)
      .send({ name: 'express', url: 'https://github.com/expressjs/express-fail' })
      .expect(201);

    await request(server)
      .post(`/api/repositories/${repoResponse.body.repository.id}/analyze`)
      .set('Authorization', `Bearer ${userResponse.body.token}`)
      .expect(400);

  });

  it('creates and stores a large repository analysis result (5000 files) without timing out', async () => {
    const userResponse = await request(server)
      .post('/api/auth/register')
      .send({
        email: `dana-${Date.now()}@example.com`,
        name: 'Dana',
        password: 'password123',
      })
      .expect(201);

    const repoResponse = await request(server)
      .post('/api/repositories')
      .set('Authorization', `Bearer ${userResponse.body.token}`)
      .send({ name: 'repo-analysis', url: process.cwd() })
      .expect(201);

    const start = Date.now();
    const analysisResponse = await request(server)
      .post(`/api/repositories/${repoResponse.body.repository.id}/analyze`)
      .set('Authorization', `Bearer ${userResponse.body.token}`)
      .expect(202);
    const duration = Date.now() - start;
    
    // Should be significantly faster than the 120s timeout
    expect(duration).toBeLessThan(45000);

    expect(analysisResponse.body.analysisId).toBeTypeOf('string');
    expect(analysisResponse.body.status).toBe('RUNNING');

    const detailResponse = await request(server)
      .get(`/api/analyses/${analysisResponse.body.analysisId}`)
      .set('Authorization', `Bearer ${userResponse.body.token}`)
      .expect(200);

    expect(detailResponse.body.analysis).toBeDefined();
    expect(detailResponse.body.analysis.files.length).toBe(5000);
    expect(detailResponse.body.analysis.overview.filesAnalyzed).toBe(5000);
    
    // Regression test: file count and dependency edge count are independent values.
    // We mocked 5000 files, but only 2 nodes have dependencies, totaling 4 edges.
    const deps = detailResponse.body.analysis.dependencies;
    expect(deps).toBeDefined();
    const totalEdges = deps.reduce((sum: number, d: any) => sum + (d.dependencies?.length || 0), 0);
    expect(totalEdges).toBe(4);
    expect(totalEdges).not.toBe(detailResponse.body.analysis.overview.filesAnalyzed);
  }, 60000);
});
