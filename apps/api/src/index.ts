import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { config } from './config.js';
import { createToken, hashPassword, comparePassword } from './auth.js';
import { requireAuth, type AuthenticatedRequest } from './middleware.js';
import { analyzeRepository } from '@change-friction/analyzer';
import { prisma } from '@change-friction/database';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { generateEngineeringBrief } from './ai/brief.js';
import { performance } from 'node:perf_hooks';

const execFileAsync = promisify(execFile);

const app = express();

const frontendOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map((url) => url.trim().replace(/\/$/, ''))
  : [];

app.use(cors({
  origin: frontendOrigins.length > 0
    ? (origin, callback) => {
        if (!origin || frontendOrigins.includes(origin) || origin === 'http://localhost:3000') {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      }
    : true,
  credentials: true,
}));
app.use(express.json());

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const repositorySchema = z.object({
  name: z.string().min(2),
  url: z.string().min(1), // Accepts url, stored in 'path' in db for compatibility
});

const getOwnedRepository = async (req: AuthenticatedRequest, id: string) => {
  const repo = await prisma.repository.findUnique({ where: { id } });
  if (!repo) return null;
  if (repo.userId !== req.user!.id) return null;
  return repo;
};

const serializeDbAnalysis = (analysis: any) => {
  const summary = (analysis.summary as any) ?? {};
  const dependencies = summary.dependencies ?? [];
  const cochanges = summary.coChanges ?? [];

  const files = analysis.fileMetrics?.map((fm: any) => ({
    path: fm.file?.path ?? '',
    metrics: {
      dependencyImpact: fm.dependencyImpact,
      changeFrequency: fm.changeFrequency,
      coChangeCoupling: fm.coChangeCoupling,
      contributorComplexity: fm.contributorComplexity,
      historicalRisk: fm.historicalRisk,
      frictionScore: fm.frictionScore
    },
    explanation: fm.explanation,
    dependencyCount: fm.dependencyCount,
    dependentCount: fm.dependentCount,
    changeCount: fm.changeCount,
    contributorCount: fm.contributorCount,
    coChangedWith: fm.coChangedWith,
    historicalEvidence: fm.historicalEvidence
  })) ?? [];

  return {
    id: analysis.id,
    repositoryId: analysis.repositoryId,
    status: 'COMPLETED',
    createdAt: analysis.createdAt.toISOString(),
    updatedAt: analysis.updatedAt.toISOString(),
    score: analysis.overallScore,
    files,
    overview: {
      overallScore: summary.overallScore ?? analysis.overallScore,
      filesAnalyzed: summary.filesAnalyzed ?? 0,
      highFrictionFiles: summary.highFrictionFiles ?? 0,
      mediumFrictionFiles: summary.mediumFrictionFiles ?? 0,
      lowFrictionFiles: summary.lowFrictionFiles ?? 0,
      topHighFrictionModules: summary.topHighFrictionModules ?? [],
      languages: (summary.languages ?? {}) as Record<string, number>
    },
    dependencies,
    cochanges,
    errorMessage: undefined
  };
};

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/api/auth/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid input.', issues: parsed.error.issues });
    return;
  }

  const user = parsed.data;
  
  try {
    const existing = await prisma.user.findUnique({ where: { email: user.email } });
    if (existing) {
      res.status(409).json({ message: 'User already exists.' });
      return;
    }

    const passwordHash = await hashPassword(user.password);
    const persisted = await prisma.user.create({
      data: {
        email: user.email,
        name: user.name,
        password: passwordHash,
      },
    });

    const token = createToken({ id: persisted.id, email: persisted.email, name: persisted.name });
    res.status(201).json({ token, user: { id: persisted.id, email: persisted.email, name: persisted.name } });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid input.', issues: parsed.error.issues });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (!user) {
      res.status(401).json({ message: 'Invalid credentials.' });
      return;
    }

    const valid = await comparePassword(parsed.data.password, user.password);
    if (!valid) {
      res.status(401).json({ message: 'Invalid credentials.' });
      return;
    }

    const token = createToken({ id: user.id, email: user.email, name: user.name });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/api/auth/me', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.user!.email } });
    if (!user) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }

    res.json({ user: { id: user.id, email: user.email, name: user.name } });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/api/repositories', requireAuth, async (req: AuthenticatedRequest, res) => {
  const parsed = repositorySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid input.', issues: parsed.error.issues });
    return;
  }

  try {
    const duplicate = await prisma.repository.findFirst({
      where: {
        userId: req.user!.id,
        OR: [
          { path: { equals: parsed.data.url, mode: 'insensitive' } },
          { name: { equals: parsed.data.name, mode: 'insensitive' } }
        ]
      },
      include: {
        analyses: { select: { id: true, overallScore: true }, orderBy: { createdAt: 'desc' } }
      }
    });

    if (duplicate) {
      res.status(200).json({ repository: { ...duplicate, ownerId: duplicate.userId, analyses: duplicate.analyses.map(a => ({ id: a.id, score: a.overallScore })) } });
      return;
    }

    const repo = await prisma.repository.create({
      data: {
        name: parsed.data.name,
        path: parsed.data.url,
        userId: req.user!.id,
      },
    });

    res.status(201).json({ repository: { ...repo, ownerId: repo.userId, analyses: [] } });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/api/repositories', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userRepos = await prisma.repository.findMany({
      where: { userId: req.user!.id },
      include: {
        analyses: { select: { id: true, overallScore: true, createdAt: true }, orderBy: { createdAt: 'desc' } }
      }
    });
    
    const formatted = userRepos.map(repo => ({
      ...repo,
      ownerId: repo.userId,
      analyses: repo.analyses.map(a => ({ id: a.id, score: a.overallScore, createdAt: a.createdAt.toISOString() }))
    }));
    
    res.json({ repositories: formatted });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/api/repositories/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const repo = await prisma.repository.findUnique({ 
      where: { id },
      include: {
        analyses: { select: { id: true, overallScore: true, createdAt: true }, orderBy: { createdAt: 'desc' } }
      }
    });
    if (!repo) {
      res.status(404).json({ message: 'Repository not found.' });
      return;
    }
    if (repo.userId !== req.user!.id) {
      res.status(403).json({ message: 'You are not allowed to access this repository.' });
      return;
    }
    res.json({ repository: { ...repo, ownerId: repo.userId, analyses: repo.analyses.map(a => ({ id: a.id, score: a.overallScore, createdAt: a.createdAt.toISOString() })) } });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.delete('/api/repositories/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const repo = await prisma.repository.findUnique({ where: { id } });
    if (!repo) {
      res.status(404).json({ message: 'Repository not found.' });
      return;
    }
    if (repo.userId !== req.user!.id) {
      res.status(403).json({ message: 'You are not allowed to delete this repository.' });
      return;
    }
    await prisma.repository.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/api/repositories/:id/analyze', requireAuth, async (req: AuthenticatedRequest, res) => {
  const reqStartTime = performance.now();
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  console.log(`[Analyze Timing] request received - id: ${id}`);

  const repoLookupStart = performance.now();
  const repo = await getOwnedRepository(req, id);
  const repoLookupElapsed = performance.now() - repoLookupStart;
  console.log(`[Analyze Timing] repository lookup - ${repoLookupElapsed.toFixed(1)}ms`);

  if (!repo) {
    console.log(`[Analyze] Repository not found or not owned: ${id}`);
    res.status(404).json({ message: 'Repository not found.' });
    return;
  }

  let tmpDir: string | null = null;
  try {
    let targetPath = repo.path;
    const isGitHubUrl = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo.path);
    console.log(`[Analyze] URL detected: ${repo.path} (isGitHubUrl: ${isGitHubUrl})`);

    if (isGitHubUrl) {
      const isWindows = os.platform() === 'win32';
      let baseTmpDir = os.tmpdir();
      
      if (isWindows) {
        const shortTmp = 'C:\\cfa-tmp';
        try {
          if (!fs.existsSync(shortTmp)) {
            fs.mkdirSync(shortTmp, { recursive: true });
          }
          baseTmpDir = shortTmp;
        } catch (err) {
          console.warn(`[Analyze] Could not create short temp dir ${shortTmp}, falling back to ${baseTmpDir}`);
        }
      }
      
      tmpDir = fs.mkdtempSync(path.join(baseTmpDir, 'cfa-'));
      console.log(`[Analyze Timing] clone started - repo: ${repo.path} to ${tmpDir}`);
      const cloneStart = performance.now();
      // Use depth 500 for meaningful git history while keeping clone relatively fast
      // Add timeout (5 mins) and 10MB max buffer to prevent infinite hangs
      // Using --filter=blob:none to avoid downloading unnecessary blobs for large repositories
      await execFileAsync('git', ['-c', 'core.longpaths=true', 'clone', '--depth', '500', '--filter=blob:none', repo.path, tmpDir], { timeout: 300000, maxBuffer: 10 * 1024 * 1024 });
      const cloneElapsed = performance.now() - cloneStart;
      console.log(`[Analyze Timing] clone completed - ${cloneElapsed.toFixed(1)}ms`);
      targetPath = tmpDir;
    } else if (repo.path.startsWith('https://')) {
      res.status(400).json({ message: 'Only github.com URLs are supported.' });
      return;
    }

    console.log(`[Analyze Timing] analyzer started`);
    const analyzerStart = performance.now();
    const result = analyzeRepository({ repositoryPath: targetPath });
    const analyzerElapsed = performance.now() - analyzerStart;
    console.log(`[Analyze Timing] analyzer completed - ${analyzerElapsed.toFixed(1)}ms (files: ${result.files.length})`);

    const summaryData = result.summary ?? { overallScore: result.overallScore ?? 0, filesAnalyzed: 0, highFrictionFiles: 0, mediumFrictionFiles: 0, lowFrictionFiles: 0, topHighFrictionModules: [] };
    
    const augmentedSummary = {
      ...summaryData,
      dependencies: result.dependencies ?? [],
      coChanges: result.coChanges ?? [],
      languages: result.languages ?? {}
    };

    console.log(`[Analyze Timing] database persistence started`);
    const dbStart = performance.now();
    const filePaths = (result.files || []).map(f => f.path);

    const tFilesStart = performance.now();
    // 1. Fetch existing files in a single indexed query outside of the transaction
    const existingDbFiles = await prisma.file.findMany({
      where: { repositoryId: repo.id },
      select: { id: true, path: true }
    });
    const fileIdMap = new Map<string, string>(existingDbFiles.map(f => [f.path, f.id]));

    // 2. Identify and batch-insert any new files that do not exist yet
    const newPaths = filePaths.filter(p => !fileIdMap.has(p));
    if (newPaths.length > 0) {
      const FILE_CHUNK_SIZE = 2000;
      for (let i = 0; i < newPaths.length; i += FILE_CHUNK_SIZE) {
        const chunk = newPaths.slice(i, i + FILE_CHUNK_SIZE);
        await prisma.file.createMany({
          data: chunk.map(path => ({
            repositoryId: repo.id,
            path
          })),
          skipDuplicates: true
        });
      }
      for (let i = 0; i < newPaths.length; i += FILE_CHUNK_SIZE) {
        const chunk = newPaths.slice(i, i + FILE_CHUNK_SIZE);
        const newlyCreatedFiles = await prisma.file.findMany({
          where: {
            repositoryId: repo.id,
            path: { in: chunk }
          },
          select: { id: true, path: true }
        });
        for (const f of newlyCreatedFiles) {
          fileIdMap.set(f.path, f.id);
        }
      }
    }
    // 3. Persist Analysis and FileMetrics together in a lean transaction using batched createMany
    const createdAnalysis = await prisma.$transaction(async (tx) => {
      const analysis = await tx.analysis.create({
        data: {
          repositoryId: repo.id,
          overallScore: result.overallScore ?? 0,
          summary: augmentedSummary,
          commitCount: result.repository?.commitCount ?? 0,
          fileCount: result.repository?.fileCount ?? 0,
        }
      });

      const fileMetricsData = (result.files || []).map(file => ({
        analysisId: analysis.id,
        fileId: fileIdMap.get(file.path)!,
        dependencyImpact: file.metrics.dependencyImpact,
        changeFrequency: file.metrics.changeFrequency,
        coChangeCoupling: file.metrics.coChangeCoupling,
        contributorComplexity: file.metrics.contributorComplexity,
        historicalRisk: file.metrics.historicalRisk,
        frictionScore: file.metrics.frictionScore,
        explanation: file.explanation,
        dependencyCount: file.dependencyCount,
        dependentCount: file.dependentCount,
        changeCount: file.changeCount,
        contributorCount: file.contributorCount,
        coChangedWith: file.coChangedWith,
        historicalEvidence: file.historicalEvidence
      }));

      const METRIC_CHUNK_SIZE = 1000;
      for (let i = 0; i < fileMetricsData.length; i += METRIC_CHUNK_SIZE) {
        const chunk = fileMetricsData.slice(i, i + METRIC_CHUNK_SIZE);
        await tx.fileMetric.createMany({
          data: chunk,
          skipDuplicates: true
        });
      }

      return analysis;
    }, { timeout: 60000 });
    
    const dbElapsed = performance.now() - dbStart;
    console.log(`[Analyze Timing] database persistence completed - ${dbElapsed.toFixed(1)}ms. Analysis ID: ${createdAnalysis.id}`);
    res.status(202).json({ analysisId: createdAnalysis.id, status: 'RUNNING', repositoryId: repo.id, score: createdAnalysis.overallScore });
    const totalElapsed = performance.now() - reqStartTime;
    console.log(`[Analyze Timing] response sent - total: ${totalElapsed.toFixed(1)}ms`);
  } catch (error) {
    console.error(`[Analyze] Error:`, error);
    const message = error instanceof Error ? error.message : 'Analysis failed.';
    res.status(400).json({ message });
  } finally {
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        console.log(`[Analyze] Cleanup completed`);
      } catch (err) {
        console.error(`[Analyze] Failed to clean up temp dir: ${tmpDir}`, err);
      }
    }
  }
});

app.get('/api/analyses/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const analysis = await prisma.analysis.findUnique({
      where: { id },
      include: {
        repository: true,
        fileMetrics: { include: { file: true } }
      }
    });

    if (!analysis) {
      res.status(404).json({ message: 'Analysis not found.' });
      return;
    }

    if (analysis.repository.userId !== req.user!.id) {
      res.status(403).json({ message: 'You are not allowed to access this analysis.' });
      return;
    }

    res.json({ analysis: serializeDbAnalysis(analysis) });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/api/analyses/:id/overview', requireAuth, async (req: AuthenticatedRequest, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const analysis = await prisma.analysis.findUnique({
      where: { id },
      include: { repository: true }
    });
    if (!analysis) {
      res.status(404).json({ message: 'Analysis not found.' });
      return;
    }
    if (analysis.repository.userId !== req.user!.id) {
      res.status(403).json({ message: 'You are not allowed to view this analysis.' });
      return;
    }

    const serialized = serializeDbAnalysis(analysis);
    res.json({ overview: serialized.overview });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/api/analyses/:id/files', requireAuth, async (req: AuthenticatedRequest, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const analysis = await prisma.analysis.findUnique({
      where: { id },
      include: { repository: true, fileMetrics: { include: { file: true } } }
    });
    if (!analysis) {
      res.status(404).json({ message: 'Analysis not found.' });
      return;
    }
    if (analysis.repository.userId !== req.user!.id) {
      res.status(403).json({ message: 'You are not allowed to view these files.' });
      return;
    }

    const serialized = serializeDbAnalysis(analysis);
    const files = serialized.files.slice().sort((a: any, b: any) => (b.metrics.frictionScore ?? 0) - (a.metrics.frictionScore ?? 0));
    res.json({ files });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/api/analyses/:id/files/:fileId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const fileId = Array.isArray(req.params.fileId) ? req.params.fileId[0] : req.params.fileId;
  try {
    const analysis = await prisma.analysis.findUnique({
      where: { id },
      include: { repository: true, fileMetrics: { include: { file: true } } }
    });
    if (!analysis) {
      res.status(404).json({ message: 'Analysis not found.' });
      return;
    }
    if (analysis.repository.userId !== req.user!.id) {
      res.status(403).json({ message: 'You are not allowed to view this file.' });
      return;
    }

    const serialized = serializeDbAnalysis(analysis);
    const file = serialized.files.find((item: any) => item.path === fileId || item.path.endsWith(`/${fileId}`));
    if (!file) {
      res.status(404).json({ message: 'File not found.' });
      return;
    }

    res.json({ file });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/api/analyses/:id/files/:fileId/ai-brief', requireAuth, async (req: AuthenticatedRequest, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const fileId = Array.isArray(req.params.fileId) ? req.params.fileId[0] : req.params.fileId;
  try {
    const analysis = await prisma.analysis.findUnique({
      where: { id },
      include: { repository: true, fileMetrics: { include: { file: true } } }
    });
    if (!analysis) {
      res.status(404).json({ message: 'Analysis not found.' });
      return;
    }
    if (analysis.repository.userId !== req.user!.id) {
      res.status(403).json({ message: 'You are not allowed to view this file.' });
      return;
    }

    const serialized = serializeDbAnalysis(analysis);
    const file = serialized.files.find((item: any) => item.path === fileId || item.path.endsWith(`/${fileId}`));
    if (!file) {
      res.status(404).json({ message: 'File not found.' });
      return;
    }

    try {
      const brief = await generateEngineeringBrief(file);
      res.json({ brief });
    } catch (aiError) {
      console.error('[AI] Brief generation failed:', aiError);
      res.status(503).json({ message: 'AI service unavailable.' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/api/analyses/:id/dependencies', requireAuth, async (req: AuthenticatedRequest, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const analysis = await prisma.analysis.findUnique({
      where: { id },
      include: { repository: true }
    });
    if (!analysis) {
      res.status(404).json({ message: 'Analysis not found.' });
      return;
    }
    if (analysis.repository.userId !== req.user!.id) {
      res.status(403).json({ message: 'You are not allowed to view dependencies.' });
      return;
    }

    const serialized = serializeDbAnalysis(analysis);
    res.json({ dependencies: serialized.dependencies });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/api/analyses/:id/cochanges', requireAuth, async (req: AuthenticatedRequest, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const analysis = await prisma.analysis.findUnique({
      where: { id },
      include: { repository: true }
    });
    if (!analysis) {
      res.status(404).json({ message: 'Analysis not found.' });
      return;
    }
    if (analysis.repository.userId !== req.user!.id) {
      res.status(403).json({ message: 'You are not allowed to view co-change data.' });
      return;
    }

    const serialized = serializeDbAnalysis(analysis);
    res.json({ cochanges: serialized.cochanges });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

export const server = app;

if (process.env.NODE_ENV !== 'test') {
  app.listen(config.port, () => {
    console.log(`API listening on port ${config.port}`);
  });
}
