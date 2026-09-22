import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { analyzeRepository } from '@change-friction/analyzer';

const execFileAsync = promisify(execFile);

export interface AnalyzeOptions {
  /** GitHub repository URL */
  repoUrl: string;
  /** Optional path to write analysis output (not used currently) */
  analysisPath?: string;
  /** Git clone depth – defaults to 500 to match API */
  depth?: string;
}

/**
 * Clone the given repository, run the deterministic analyzer, and clean up.
 * Returns the analysis result exactly as {@link analyzeRepository} does.
 */
export async function analyzeLocalRepository(options: AnalyzeOptions) {
  const { repoUrl, analysisPath, depth = '500' } = options;
  const isGitHubUrl = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?$/.test(repoUrl);
  if (!isGitHubUrl) {
    throw new Error('Only github.com URLs are supported.');
  }

  let tmpDir: string | null = null;
  try {
    const isWindows = os.platform() === 'win32';
    let baseTmpDir = os.tmpdir();
    if (isWindows) {
      const shortTmp = 'C:\\cfa-tmp';
      try {
        if (!fs.existsSync(shortTmp)) {
          fs.mkdirSync(shortTmp, { recursive: true });
        }
        baseTmpDir = shortTmp;
      } catch {}
    }
    tmpDir = fs.mkdtempSync(path.join(baseTmpDir, 'cfa-'));
    await execFileAsync('git', [
      '-c', 'core.longpaths=true',
      'clone',
      '--depth', depth,
      '--filter=blob:none',
      repoUrl,
      tmpDir,
    ], { timeout: 300000, maxBuffer: 10 * 1024 * 1024 });

    const result = analyzeRepository({
      repositoryPath: tmpDir,
      ...(analysisPath ? { analysisPath } : {}),
    });
    return result;
  } finally {
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }
}
